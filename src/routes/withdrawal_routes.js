const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs-extra');
const { loadJson, saveJson, getUserById } = require('../utils/storage_utils');
const { authenticateToken, restrictTo } = require('../middleware/auth_middleware');
const { TELEGRAM_API, DATA_PATH } = require('../config/constants');
const { shouldLogSendError, axiosWithRetry } = require('../utils');

const router = express.Router();

router.get('/withdrawals', authenticateToken, restrictTo('mainAdmin'), async (req, res) => {
    try {
        let data = loadJson('withdrawals');
        if (!Array.isArray(data)) {
            data = Object.values(data);
        }

        const { search, page = 1, perPage = 50, status } = req.query;
        const term = search ? search.trim().toLowerCase() : '';
        const pageNum = parseInt(page, 10) || 1;
        const perPageNum = parseInt(perPage, 10) || 50;

        let filtered = data.filter(w => {
            if (!w || w.status === 'draft') return false;
            
            if (status) {
                const statusMap = {
                    'open': ['pending'],
                    'completed': ['completed']
                };
                if (statusMap[status] && !statusMap[status].includes(w.status)) {
                    return false;
                }
            }
            
            if (term) {
                const user = getUserById(w.userId) || {};
                return (
                    (w.id && w.id.toString().includes(term)) ||
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
        console.error('Error fetching withdrawals:', err.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

router.patch('/withdrawals/:id/complete', authenticateToken, restrictTo('mainAdmin'), async (req, res) => {
    try {
        let withdrawals = loadJson('withdrawals');
        const idx = withdrawals.findIndex(w => w.id === req.params.id);
        if (idx === -1) {
            return res.sendStatus(404);
        }

        withdrawals[idx] = { ...withdrawals[idx], status: 'completed' };
        saveJson('withdrawals', withdrawals);

        const withdrawal = withdrawals[idx];
        const userId = withdrawal.userId;
        const caption = `✅ Вывод рефералов завершен! №${withdrawal.id}\nКоличество: ${withdrawal.cryptoAmount} BTC (~${withdrawal.rubAmount} RUB)\nКошелёк: ${withdrawal.walletAddress}`;

        const config = loadJson('config');

        try {
            const operators = config.multipleOperatorsData.filter(op => op.currency === 'BTC');
            const operator = operators[0] || config.multipleOperatorsData[0];
            const contactUrl = operator?.username ? `https://t.me/${operator.username}` : 'https://t.me/OperatorName';

            const form = new FormData();
            form.append('chat_id', userId);
            form.append('photo', fs.createReadStream(path.join(DATA_PATH, 'images/bit-check-image.png')));
            form.append('caption', caption);
            form.append('reply_markup', JSON.stringify({
                inline_keyboard: [
                    [{ text: '📞 Написать оператору', url: contactUrl }],
                ]
            }));
            await axiosWithRetry(
                () => axios.post(`${TELEGRAM_API}/sendPhoto`, form, {
                    headers: form.getHeaders(),
                    timeout: 5000
                })
            );
        } catch (error) {
            if (shouldLogSendError(error)) {
                console.error(`Error sending withdrawal notification to user ${userId}:`, error.message);
            }
        }

        res.json(withdrawals[idx]);
    } catch (error) {
        console.error('Error completing withdraw:', error.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router;

