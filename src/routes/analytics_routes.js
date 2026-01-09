const express = require('express');
const { loadJson } = require('../utils/storage_utils');
const { authenticateToken } = require('../middleware/auth_middleware');

const router = express.Router();

function getPeriodFilter(period) {
    const now = new Date();
    let startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);

    switch (period) {
        case 'day':
            startDate.setDate(now.getDate());
            break;
        case 'week':
            startDate.setDate(now.getDate() - 6);
            break;
        case 'month':
            startDate.setDate(now.getDate() - 29);
            break;
        case 'year':
            startDate.setDate(now.getDate() - 364);
            break;
        default:
            startDate = new Date(0);
    }

    return (item) => {
        if (!item || !item.timestamp) return false;
        const itemDate = new Date(item.timestamp);
        if (isNaN(itemDate.getTime())) return false;
        itemDate.setHours(0, 0, 0, 0);
        return itemDate >= startDate;
    };
}

router.get('/analytics/stats', authenticateToken, (req, res) => {
    try {
        let deals = loadJson('deals') || [];
        if (!Array.isArray(deals)) {
            deals = Object.values(deals);
        }

        let users = loadJson('users') || [];
        if (!Array.isArray(users)) {
            users = Object.values(users);
        }

        let completedDeals = deals.filter(d => d && d.status === 'completed');

        if (req.user.role === 'admin') {
            completedDeals = completedDeals.filter(d => d.currency === req.user.currency);
        }

        const periods = ['day', 'week', 'month', 'year'];
        const stats = {
            deals: {},
            commission: {},
            users: {}
        };

        periods.forEach(period => {
            const periodFilter = getPeriodFilter(period);
            
            const periodDeals = completedDeals.filter(d => periodFilter(d));
            const dealCount = periodDeals.length;
            const dealAmount = periodDeals.reduce((sum, d) => sum + (d.total || d.rubAmount || 0), 0);
            const commissionTotal = periodDeals.reduce((sum, d) => sum + (d.commission || 0), 0);

            stats.deals[period] = {
                count: dealCount,
                amount: dealAmount
            };
            stats.commission[period] = commissionTotal;

            const registeredUsers = users.filter(u => {
                if (!u || !u.registrationDate) return false;
                return periodFilter({ timestamp: u.registrationDate });
            });
            stats.users[period] = registeredUsers.length;
        });

        res.json(stats);
    } catch (err) {
        console.error('Error fetching analytics stats:', err.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router;

