const express = require('express');
const { 
    loadJson, 
    saveJson,
    getCompletedDealsByUserId,
    getWithdrawalsByUserId
} = require('../utils/storage-utils');
const { authenticateToken, restrictTo } = require('../middleware');

const router = express.Router();

function getPeriodStart(period) {
    const now = new Date();
    switch (period) {
        case 'day':
            return new Date(now.setHours(0, 0, 0, 0));
        case 'week':
            const weekStart = new Date(now);
            weekStart.setDate(now.getDate() - now.getDay());
            weekStart.setHours(0, 0, 0, 0);
            return weekStart;
        case 'month':
            return new Date(now.getFullYear(), now.getMonth(), 1);
        case 'year':
            return new Date(now.getFullYear(), 0, 1);
        default:
            return null;
    }
}

function filterDealsByPeriod(deals, period) {
    if (!period || period === 'all') {
        return deals;
    }
    const periodStart = getPeriodStart(period);
    if (!periodStart) {
        return deals;
    }
    return deals.filter(d => new Date(d.timestamp) >= periodStart);
}

router.get('/users', authenticateToken, (req, res) => {
    try {
        let users = loadJson('users') || [];
        if (!Array.isArray(users)) {
            users = Object.values(users);
        }
        
        const { search, page = 1, perPage = 50, registrationDate, dealsCount, turnover, activity, period } = req.query;
        const pageNum = parseInt(page, 10) || 1;
        const perPageNum = parseInt(perPage, 10) || 50;
        
        const term = search ? search.trim().toLowerCase() : '';
        const regDateFilter = registrationDate || null;
        const dealsCountFilter = dealsCount ? parseInt(dealsCount, 10) : null;
        const turnoverFilter = turnover ? parseFloat(turnover) : null;
        const activityFilter = activity || null;
        
        let filtered = users.filter(u => {
            if (term && !u.id.toString().includes(term) && !(u.username && u.username.toLowerCase().includes(term))) {
                return false;
            }
            if (regDateFilter && (!u.registrationDate || u.registrationDate.split('T')[0] !== regDateFilter)) {
                return false;
            }
            return true;
        });
        
        if (dealsCountFilter !== null || turnoverFilter !== null || activityFilter) {
            filtered = filtered.map(u => {
                const userDeals = filterDealsByPeriod(getCompletedDealsByUserId(u.id), period);
                const userWithdrawals = getWithdrawalsByUserId(u.id).filter(w => w.status === 'completed');
                const userDealsCount = userDeals.length;
                const userTurnover = userDeals.reduce((sum, d) => sum + (d.rubAmount || d.amount || 0), 0);
                
                let latestActivity = null;
                if (userDeals.length > 0 || userWithdrawals.length > 0) {
                    const allActivities = [...userDeals, ...userWithdrawals]
                        .map(item => new Date(item.timestamp).getTime())
                        .sort((a, b) => b - a);
                    latestActivity = allActivities[0] ? new Date(allActivities[0]).toISOString().split('T')[0] : null;
                }
                
                return {
                    ...u,
                    _stats: {
                        dealsCount: userDealsCount,
                        turnover: userTurnover,
                        lastActivityDate: latestActivity,
                        userDeals: userDeals
                    }
                };
            }).filter(u => {
                if (dealsCountFilter !== null && u._stats.dealsCount < dealsCountFilter) {
                    return false;
                }
                if (turnoverFilter !== null && u._stats.turnover < turnoverFilter) {
                    return false;
                }
                if (activityFilter && (!u._stats.lastActivityDate || u._stats.lastActivityDate < activityFilter)) {
                    return false;
                }
                return true;
            });
        } else {
            filtered = filtered.map(u => {
                const userDeals = filterDealsByPeriod(getCompletedDealsByUserId(u.id), period);
                const userWithdrawals = getWithdrawalsByUserId(u.id).filter(w => w.status === 'completed');
                const userDealsCount = userDeals.length;
                const userTurnover = userDeals.reduce((sum, d) => sum + (d.rubAmount || d.amount || 0), 0);
                
                let latestActivity = null;
                if (userDeals.length > 0 || userWithdrawals.length > 0) {
                    const allActivities = [...userDeals, ...userWithdrawals]
                        .map(item => new Date(item.timestamp).getTime())
                        .sort((a, b) => b - a);
                    latestActivity = allActivities[0] ? new Date(allActivities[0]).toISOString().split('T')[0] : null;
                }
                
                return {
                    ...u,
                    _stats: {
                        dealsCount: userDealsCount,
                        turnover: userTurnover,
                        lastActivityDate: latestActivity,
                        userDeals: userDeals
                    }
                };
            });
        }
        
        filtered.sort((a, b) => {
            const hasDealsA = a._stats && a._stats.dealsCount > 0;
            const hasDealsB = b._stats && b._stats.dealsCount > 0;

            if (hasDealsA && hasDealsB) {
                const timeA = new Date(a._stats.lastActivityDate || 0).getTime();
                const timeB = new Date(b._stats.lastActivityDate || 0).getTime();
                return timeB - timeA;
            }

            if (hasDealsA && !hasDealsB) {
                return -1;
            }

            if (!hasDealsA && hasDealsB) {
                return 1;
            }

            const timeA = new Date(a.registrationDate || 0).getTime();
            const timeB = new Date(b.registrationDate || 0).getTime();
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
        console.error('Error fetching users:', err.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

router.put('/users/:id', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    try {
        const users = loadJson('users') || [];
        const idx = users.findIndex(u => u.id === +req.params.id);
        if (idx !== -1) {
            users[idx] = { ...users[idx], ...req.body };
            saveJson('users', users);
            return res.json(users[idx]);
        }
        res.sendStatus(404);
    } catch (err) {
        console.error('Error updating user:', err.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

router.delete('/users/:id', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    try {
        let users = loadJson('users') || [];
        const userId = parseInt(req.params.id, 10);

        let deals = loadJson('deals') || [];
        deals = deals.filter(d => d.userId !== userId);
        saveJson('deals', deals);

        let withdrawals = loadJson('withdrawals') || [];
        withdrawals = withdrawals.filter(w => w.userId !== userId);
        saveJson('withdrawals', withdrawals);

        users = users.map(u => ({
            ...u,
            referrals: u.referrals ? u.referrals.filter(refId => refId !== userId) : []
        }));

        users = users.filter(u => u.id !== userId);
        saveJson('users', users);

        res.sendStatus(204);
    } catch (err) {
        console.error('Error deleting user:', err.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

router.get('/users/analytics', authenticateToken, (req, res) => {
    try {
        let users = loadJson('users') || [];
        if (!Array.isArray(users)) {
            users = Object.values(users);
        }

        res.json(users);
    } catch (err) {
        console.error('Error fetching users for analytics:', err.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router;

