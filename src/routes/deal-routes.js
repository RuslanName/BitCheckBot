const express = require('express');
const axios = require('axios');
const FormData = require('form-data');
const path = require('path');
const fs = require('fs-extra');
const { loadJson, saveJson, getUserById } = require('../utils/storage-utils');
const { authenticateToken } = require('../middleware');
const { TELEGRAM_API, BIT_CHECK_IMAGE_PATH, BIT_CHECK_REVIEW_URL } = require('../config');
const { shouldLogSendError, axiosWithRetry } = require('../utils');
const { addCashback, calculateCashback } = require('../services/cashback-service');

const router = express.Router();

router.get('/deals', authenticateToken, async (req, res) => {
    try {
        let data = loadJson('deals') || [];
        if (!Array.isArray(data)) {
            data = Object.values(data);
        }
        const { search, page = 1, perPage = 50, status } = req.query;
        const term = search ? search.trim().toLowerCase() : '';
        const pageNum = parseInt(page, 10) || 1;
        const perPageNum = parseInt(perPage, 10) || 50;

        let filtered = data.filter(d => {
            if (!d) return false;
            
            if (status && d.status === 'draft') return false;
            
            if (status) {
                const statusMap = {
                    'open': ['draft', 'pending'],
                    'completed': ['completed'],
                    'expired': ['expired']
                };
                if (statusMap[status] && !statusMap[status].includes(d.status)) {
                    return false;
                }
            }
            
            if (term) {
                const user = getUserById(d.userId) || {};
                return (
                    (d.id && d.id.toString().toLowerCase().includes(term)) ||
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
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

router.patch('/deals/:id/complete', authenticateToken, async (req, res) => {
    try {
        let deals = loadJson('deals') || [];
        const idx = deals.findIndex(d => d.id === req.params.id);
        if (idx === -1) {
            return res.sendStatus(404);
        }
        if (req.user.role === 'admin' && deals[idx].currency !== req.user.currency) {
            return res.status(403).json({ error: 'Неверная валюта для вашего аккаунта' });
        }

        deals[idx] = { ...deals[idx], status: 'completed' };
        saveJson('deals', deals);

        const deal = deals[idx];
        const userId = deal.userId;
        const actionText = deal.type === 'buy' ? 'Покупка' : 'Продажа';
        const config = loadJson('config') || {};
        const priorityPrice = deal.priority === 'elevated' ? config.priorityPriceRub : 0;
        const cashbackAmount = await calculateCashback(deal.commission);
        const caption = `✅ Сделка завершена! №${deal.id}\n${actionText} ${deal.currency}\nКоличество: ${deal.cryptoAmount} ${deal.currency}\nСумма: ${deal.rubAmount} RUB\nКомиссия: ${deal.commission} RUB (Кешбек ${cashbackAmount} руб)\nПриоритет: ${deal.priority === 'elevated' ? `Повышенный (+${priorityPrice} RUB)` : 'Обычный'}\nИтог: ${deal.total} RUB\nКошелёк: ${deal.walletAddress}`;

        await addCashback(userId, deal.commission, deal.id);

        const users = loadJson('users') || [];

        try {
            const reviewChatUrl = BIT_CHECK_REVIEW_URL;
            
            const form = new FormData();
            form.append('chat_id', userId);
            form.append('photo', fs.createReadStream(BIT_CHECK_IMAGE_PATH));
            form.append('caption', caption);
            form.append('reply_markup', JSON.stringify({
                inline_keyboard: [
                    [{ text: '⭐️ Оставить отзыв', url: reviewChatUrl }],
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
                console.error(`Error sending notification to user ${userId}:`, error.message);
            }
        }

        const referrer = users.find(u => u.referrals && u.referrals.includes(deal.userId));
        if (referrer) {
            const referralRevenuePercent = config.referralRevenuePercent / 100;
            const btcPrice = await (async () => {
                try {
                    const response = await axiosWithRetry(
                        () => axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=rub', { timeout: 5000 })
                    );
                    return response.data.bitcoin.rub || 5000000;
                } catch (error) {
                    console.error('Error fetching BTC price after all retries:', error.message);
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
                form.append('photo', fs.createReadStream(BIT_CHECK_IMAGE_PATH));
                form.append('caption', `🎉 Реферальный бонус! +${commissionBTC.toFixed(8)} BTC (~${earningsRub.toFixed(2)}) за сделку ID ${deal.id}`);
                await axios.post(`${TELEGRAM_API}/sendPhoto`, form, {
                    headers: form.getHeaders(),
                    timeout: 5000
                });
            } catch (error) {
                if (shouldLogSendError(error)) {
                    console.error(`Error sending notification to referrer ${referrer.id}:`, error.message);
                }
            }
        }

        return res.json(deals[idx]);
    } catch (error) {
        console.error('Error completing deal:', error.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

router.patch('/deals/:id/cancel', authenticateToken, async (req, res) => {
    try {
        let deals = loadJson('deals') || [];
        const idx = deals.findIndex(d => d.id === req.params.id);
        if (idx === -1) {
            return res.sendStatus(404);
        }
        if (req.user.role === 'admin' && deals[idx].currency !== req.user.currency) {
            return res.status(403).json({ error: 'Неверная валюта для вашего аккаунта' });
        }

        deals[idx] = { ...deals[idx], status: 'canceled' };
        saveJson('deals', deals);

        const deal = deals[idx];
        const userId = deal.userId;
        const actionText = deal.type === 'buy' ? 'Покупка' : 'Продажа';
        const caption = `❌ Сделка отменена! №${deal.id}\n${actionText} ${deal.currency}\nКоличество: ${deal.cryptoAmount} ${deal.currency}\nСумма: ${deal.rubAmount} RUB`;

        try {
            const form = new FormData();
            form.append('chat_id', userId);
            form.append('photo', fs.createReadStream(BIT_CHECK_IMAGE_PATH));
            form.append('caption', caption);
            await axiosWithRetry(
                () => axios.post(`${TELEGRAM_API}/sendPhoto`, form, {
                    headers: form.getHeaders(),
                    timeout: 5000
                })
            );
        } catch (error) {
            if (shouldLogSendError(error)) {
                console.error(`Error sending notification to user ${userId}:`, error.message);
            }
        }

        return res.json(deals[idx]);
    } catch (error) {
        console.error('Error canceling deal:', error.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

router.delete('/deals/:id', authenticateToken, (req, res) => {
    try {
        let deals = loadJson('deals') || [];
        const deal = deals.find(d => d.id === req.params.id);
        if (!deal) {
            return res.sendStatus(404);
        }
        if (req.user.role === 'admin' && deal.currency !== req.user.currency) {
            return res.status(403).json({ error: 'Неверная валюта для вашего аккаунта' });
        }
        deals = deals.filter(d => d.id !== req.params.id);
        saveJson('deals', deals);
        res.sendStatus(204);
    } catch (err) {
        console.error('Error deleting deal:', err.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

router.get('/deals/analytics', authenticateToken, async (req, res) => {
    try {
        let data = loadJson('deals') || [];
        if (!Array.isArray(data)) {
            data = Object.values(data);
        }

        let filtered = data.filter(d => d && d.status === 'completed');

        if (req.user.role === 'admin') {
            filtered = filtered.filter(d => d.currency === req.user.currency);
        }

        res.json(filtered);
    } catch (err) {
        console.error('Error fetching deals for analytics:', err.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router;

