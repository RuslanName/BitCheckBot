const express = require('express');
const axios = require('axios');
const { loadJson, saveJson, getUserById } = require('../utils/storage-utils');
const { authenticateToken, restrictTo } = require('../middleware');
const { TELEGRAM_API } = require('../config');

const router = express.Router();

router.get('/cashback/withdrawals', authenticateToken, (req, res) => {
    try {
        let data = loadJson('cashback-withdrawals') || [];
        if (!Array.isArray(data)) {
            data = Object.values(data);
        }

        const { search, page = 1, perPage = 50, status } = req.query;
        const term = search ? search.trim().toLowerCase() : '';
        const pageNum = parseInt(page, 10) || 1;
        const perPageNum = parseInt(perPage, 10) || 50;

        let filtered = data.filter(w => {
            if (!w) return false;

            if (status) {
                if (w.status !== status) return false;
            }

            if (term) {
                const user = getUserById(w.userId) || {};
                return (
                    (w.id && w.id.toString().toLowerCase().includes(term)) ||
                    (w.userId && w.userId.toString().includes(term)) ||
                    (user.username && user.username.toLowerCase().includes(term))
                );
            }
            return true;
        });

        filtered.sort((a, b) => {
            const timeA = new Date(a.timestamp || 0).getTime();
            const timeB = new Date(b.timestamp || 0).getTime();
            return timeB - timeA;
        });

        const total = filtered.length;
        const totalPages = Math.ceil(total / perPageNum);
        const startIndex = (pageNum - 1) * perPageNum;
        const endIndex = startIndex + perPageNum;
        const paginatedData = filtered.slice(startIndex, endIndex);

        res.json({
            data: paginatedData,
            pagination: {
                page: pageNum,
                perPage: perPageNum,
                total,
                totalPages
            }
        });
    } catch (err) {
        console.error('Error fetching cashback withdrawals:', err.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

router.patch('/cashback/withdrawals/:id/complete', authenticateToken, restrictTo('mainAdmin'), async (req, res) => {
    try {
        let withdrawals = loadJson('cashback-withdrawals') || [];
        const idx = withdrawals.findIndex(w => w.id === req.params.id);
        if (idx === -1) {
            return res.sendStatus(404);
        }

        const withdrawal = withdrawals[idx];
        withdrawal.status = 'completed';
        saveJson('cashback-withdrawals', withdrawals);

        try {
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
                chat_id: withdrawal.userId,
                text: `✅ Заявка на вывод кешбека одобрена!\n\n💰 Сумма: ${withdrawal.amount.toFixed(2)} RUB\n🏦 Кошелёк: ${withdrawal.walletAddress}\n\nСредства скоро поступят на ваш кошелёк.`
            });
        } catch (notifyError) {
            console.error('Error sending completion notification:', notifyError.message);
        }

        res.json(withdrawal);
    } catch (error) {
        console.error('Error completing cashback withdrawal:', error.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

router.patch('/cashback/withdrawals/:id/reject', authenticateToken, restrictTo('mainAdmin'), async (req, res) => {
    try {
        let withdrawals = loadJson('cashback-withdrawals') || [];
        let users = loadJson('users') || [];
        const idx = withdrawals.findIndex(w => w.id === req.params.id);
        if (idx === -1) {
            return res.sendStatus(404);
        }

        const withdrawal = withdrawals[idx];
        if (withdrawal.status !== 'pending') {
            return res.status(400).json({ error: 'Можно отклонять только ожидающие заявки' });
        }

        const user = users.find(u => u.id === withdrawal.userId);
        if (user) {
            user.cashback = (user.cashback || 0) + withdrawal.amount;
            saveJson('users', users);
        }

        withdrawal.status = 'rejected';
        saveJson('cashback-withdrawals', withdrawals);

        try {
            await axios.post(`${TELEGRAM_API}/sendMessage`, {
                chat_id: withdrawal.userId,
                text: `❌ Заявка на вывод кешбека отклонена!\n\n💰 Сумма: ${withdrawal.amount.toFixed(2)} RUB\n🏦 Кошелёк: ${withdrawal.walletAddress}\n\nСредства возвращены на ваш кешбек баланс.`
            });
        } catch (notifyError) {
            console.error('Error sending rejection notification:', notifyError.message);
        }

        res.json(withdrawal);
    } catch (error) {
        console.error('Error rejecting cashback withdrawal:', error.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

router.post('/cashback/withdraw', async (req, res) => {
    try {
        const { amount, walletAddress, userId } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Некорректная сумма' });
        }

        if (!walletAddress || walletAddress.trim() === '') {
            return res.status(400).json({ error: 'Укажите кошелёк' });
        }

        if (!userId) {
            return res.status(400).json({ error: 'userId не передан' });
        }

        const { createCashbackWithdrawal, canWithdrawCashback } = require('../services/cashback-service');
        const config = loadJson('config') || {};
        const minWithdrawAmount = config.minCashbackWithdrawAmount || 1500;

        if (amount < minWithdrawAmount) {
            return res.status(400).json({ error: `Минимальная сумма вывода: ${minWithdrawAmount} RUB` });
        }

        const canWithdraw = await canWithdrawCashback(userId, amount);
        if (!canWithdraw) {
            const users = loadJson('users') || [];
            const user = users.find(u => u.id === userId);
            const available = user?.cashback || 0;
            return res.status(400).json({ error: `Недостаточно средств. Доступно: ${available.toFixed(2)} RUB` });
        }

        const withdrawal = await createCashbackWithdrawal(userId, amount, walletAddress.trim());
        res.json(withdrawal);
    } catch (error) {
        console.error('Error creating cashback withdrawal:', error.message);
        res.status(400).json({ error: error.message || 'Ошибка создания заявки' });
    }
});

router.get('/cashback/info', async (req, res) => {
    try {
        const { userId } = req.query;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId не передан' });
        }

        const users = loadJson('users') || [];
        const config = loadJson('config') || {};
        const user = users.find(u => u.id === parseInt(userId));

        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }

        res.json({
            cashback: user.cashback || 0,
            minWithdrawAmount: config.minCashbackWithdrawAmount || 1500,
            withdrawalFeePercent: 0
        });
    } catch (error) {
        console.error('Error fetching cashback info:', error.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

router.get('/cashback/withdrawals/my', async (req, res) => {
    try {
        const { userId } = req.query;
        
        if (!userId) {
            return res.status(400).json({ error: 'userId не передан' });
        }

        let data = loadJson('cashback-withdrawals') || [];
        if (!Array.isArray(data)) {
            data = Object.values(data);
        }

        const userWithdrawals = data.filter(w => w.userId === parseInt(userId));

        userWithdrawals.sort((a, b) => {
            const timeA = new Date(a.timestamp || 0).getTime();
            const timeB = new Date(b.timestamp || 0).getTime();
            return timeB - timeA;
        });

        res.json({
            data: userWithdrawals,
            total: userWithdrawals.length
        });
    } catch (error) {
        console.error('Error fetching user cashback withdrawals:', error.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router;
