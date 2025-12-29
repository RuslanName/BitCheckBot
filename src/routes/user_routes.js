const express = require('express');
const { 
    loadJson, 
    saveJson,
    getCompletedDealsByUserId,
    getWithdrawalsByUserId
} = require('../utils/storage_utils');
const { authenticateToken, restrictTo } = require('../middleware/auth_middleware');

const router = express.Router();

router.get('/users', authenticateToken, (req, res) => {
    try {
        const users = loadJson('users');
        
        const { search, page = 1, perPage = 50, registrationDate, dealsCount, turnover, activity } = req.query;
        const pageNum = parseInt(page, 10) || 1;
        const perPageNum = parseInt(perPage, 10) || 50;
        
        const term = search ? search.trim().toLowerCase() : '';
        const regDateFilter = registrationDate || null;
        const dealsCountFilter = dealsCount ? parseInt(dealsCount, 10) : null;
        const turnoverFilter = turnover ? parseFloat(turnover) : null;
        const activityFilter = activity || null;
        
        const filtered = users
            .map(u => {
                const userDeals = getCompletedDealsByUserId(u.id);
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
                        lastActivityDate: latestActivity
                    }
                };
            })
            .filter(u => {
                if (term && !u.id.toString().includes(term) && !(u.username && u.username.toLowerCase().includes(term))) {
                    return false;
                }
                if (regDateFilter && (!u.registrationDate || u.registrationDate.split('T')[0] !== regDateFilter)) {
                    return false;
                }
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
        
        filtered.sort((a, b) => {
            const timeA = new Date(a.registrationDate || 0).getTime();
            const timeB = new Date(b.registrationDate || 0).getTime();
            return timeB - timeA;
        });
        
        const total = filtered.length;
        const totalPages = Math.ceil(total / perPageNum);
        const startIndex = (pageNum - 1) * perPageNum;
        const endIndex = startIndex + perPageNum;
        const paginatedData = filtered.slice(startIndex, endIndex);
        
        paginatedData.forEach(u => {
            delete u._stats;
        });
        
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
    const users = loadJson('users');
    const idx = users.findIndex(u => u.id === +req.params.id);
    if (idx !== -1) {
        users[idx] = { ...users[idx], ...req.body };
        saveJson('users', users);
        return res.json(users[idx]);
    }
    res.sendStatus(404);
});

router.delete('/users/:id', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    try {
        let users = loadJson('users');
        const userId = parseInt(req.params.id, 10);

        let deals = loadJson('deals');
        deals = deals.filter(d => d.userId !== userId);
        saveJson('deals', deals);

        let withdrawals = loadJson('withdrawals');
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
        let users = loadJson('users');
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

