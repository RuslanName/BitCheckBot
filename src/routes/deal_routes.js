const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs-extra');
const { loadJson, saveJson } = require('../utils/storage_utils');
const { authenticateToken } = require('../middleware/auth_middleware');
const { TELEGRAM_API, DATA_PATH } = require('../config/constants');

const router = express.Router();

router.get('/deals', authenticateToken, async (req, res) => {
    try {
        let data = loadJson('deals');
        if (!Array.isArray(data)) {
            data = Object.values(data);
        }
        const { search, page = 1, perPage = 50, status } = req.query;
        const term = search ? search.trim().toLowerCase() : '';
        const pageNum = parseInt(page, 10) || 1;
        const perPageNum = parseInt(perPage, 10) || 50;

        const users = loadJson('users');

        let filtered = data.filter(d => {
            if (!d || d.status === 'draft') return false;
            
            if (status) {
                const statusMap = {
                    'open': ['unpaid', 'pending'],
                    'completed': ['completed'],
                    'expired': ['expired']
                };
                if (statusMap[status] && !statusMap[status].includes(d.status)) {
                    return false;
                }
            }
            
            const user = users.find(u => u.id === d.userId) || {};
            if (term) {
            return (
                (d.id && d.id.toString().includes(term)) ||
                (d.userId && d.userId.toString().includes(term)) ||
                (user.username && user.username.toLowerCase().includes(term))
            );
            }
            return true;
        });

        if (req.user.role === 'admin') {
            filtered = filtered.filter(d => d.currency === req.user.currency);
        }

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
        console.error('Error fetching deals:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.patch('/deals/:id/complete', authenticateToken, async (req, res) => {
    try {
        let deals = loadJson('deals');
        const idx = deals.findIndex(d => d.id === req.params.id);
        if (idx === -1) {
            return res.sendStatus(404);
        }
        if (req.user.role === 'admin' && deals[idx].currency !== req.user.currency) {
            return res.status(403).json({ error: 'Invalid currency for your account' });
        }

        deals[idx] = { ...deals[idx], status: 'completed' };
        saveJson('deals', deals);

        const deal = deals[idx];
        const userId = deal.userId;
        const actionText = deal.type === 'buy' ? 'Покупка' : 'Продажа';
        const config = loadJson('config');
        const priorityPrice = deal.priority === 'elevated' ? config.priorityPriceRub : 0;
        const caption = `✅ Сделка завершена! №${deal.id}\n${actionText} ${deal.currency}\nКоличество: ${deal.cryptoAmount} ${deal.currency}\nСумма: ${deal.rubAmount} RUB\nКомиссия: ${deal.commission} RUB\nПриоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\nИтог: ${deal.total} RUB\nКошелёк: ${deal.walletAddress}`;

        const users = loadJson('users');

        try {
            const contactUrl =
                config.multipleOperatorsMode && config.multipleOperatorsData.length > 0
                    ? `https://t.me/${(config.multipleOperatorsData.find(op => op.currency === deal.currency) || config.multipleOperatorsData[0]).username}`
                    : `https://t.me/${config.singleOperatorUsername}`;

            const form = new FormData();
            form.append('chat_id', userId);
            form.append('photo', fs.createReadStream(path.join(DATA_PATH, 'images/bit-check-image.png')));
            form.append('caption', caption);
            form.append('reply_markup', JSON.stringify({
                inline_keyboard: [
                    [{ text: '📞 Написать оператору', url: contactUrl }],
                ]
            }));
            await axios.post(`${TELEGRAM_API}/sendPhoto`, form, {
                headers: form.getHeaders(),
                timeout: 5000
            });
        } catch (error) {
            console.error(`Error sending notification to user ${userId}:`, error.message);
        }

        const referrer = users.find(u => u.referrals && u.referrals.includes(deal.userId));
        if (referrer) {
            const referralRevenuePercent = config.referralRevenuePercent / 100;
            const btcPrice = await (async () => {
                try {
                    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=rub', { timeout: 5000 });
                    return response.data.bitcoin.rub || 5000000;
                } catch (error) {
                    console.error('Error fetching BTC price:', error.message);
                    return 5000000;
                }
            })();
            const commissionBTC = (deal.commission / btcPrice) * referralRevenuePercent;
            const earningsRub = commissionBTC * btcPrice;

            referrer.balance = (referrer.balance || 0) + Number(commissionBTC.toFixed(8));
            saveJson('users', users);

            try {
                const form = new FormData();
                form.append('chat_id', referrer.id);
                form.append('photo', fs.createReadStream(path.join(DATA_PATH, 'images/bit-check-image.png')));
                form.append('caption', `🎉 Реферальный бонус! +${commissionBTC.toFixed(8)} BTC (~${earningsRub.toFixed(2)}) за сделку ID ${deal.id}`);
                await axios.post(`${TELEGRAM_API}/sendPhoto`, form, {
                    headers: form.getHeaders(),
                    timeout: 5000
                });
            } catch (error) {
                console.error(`Error sending notification to referrer ${referrer.id}:`, error.message);
            }
        }

        return res.json(deals[idx]);
    } catch (error) {
        console.error('Error completing deal:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.delete('/deals/:id', authenticateToken, (req, res) => {
    try {
        let deals = loadJson('deals');
        const deal = deals.find(d => d.id === req.params.id);
        if (!deal) {
            return res.sendStatus(404);
        }
        if (req.user.role === 'admin' && deal.currency !== req.user.currency) {
            return res.status(403).json({ error: 'Invalid currency for your account' });
        }
        deals = deals.filter(d => d.id !== req.params.id);
        saveJson('deals', deals);
        res.sendStatus(204);
    } catch (err) {
        console.error('Error deleting deal:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;

