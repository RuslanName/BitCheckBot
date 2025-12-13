const express = require('express');
const { loadJson, saveJson } = require('../utils/storage_utils');
const { authenticateToken, restrictTo } = require('../middleware/auth_middleware');

const router = express.Router();

router.get('/raffles', authenticateToken, restrictTo('mainAdmin'), async (req, res) => {
    try {
        let data = loadJson('raffles');
        if (!Array.isArray(data)) {
            data = Object.values(data);
        }

        const { search } = req.query;
        const term = search ? search.trim().toLowerCase() : '';

        data = data.filter(r => {
            if (!r || r.status === 'draft') return false;
            return r.id.toString().includes(term);
        });

        res.json(data);
    } catch (err) {
        console.error('Error fetching raffles:', err.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

router.post('/raffles', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    try {
        const list = loadJson('raffles') || [];
        const item = {
            id: Date.now().toString(),
            startDate: req.body.startDate,
            endDate: req.body.endDate,
            condition: {
                type: req.body.conditionType,
                value: req.body.conditionType === 'dealCount' ? req.body.dealCount : req.body.dealSum
            },
            prizes: req.body.prizes || [],
            timestamp: new Date().toISOString(),
            status: 'pending'
        };
        list.push(item);
        saveJson('raffles', list);
        if (req.raffleEmitter) {
            req.raffleEmitter.emit('newRaffle');
        }
        res.status(201).json(item);
    } catch (err) {
        console.error('Error creating raffle:', err.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

router.put('/raffles/:id', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    try {
        let list = loadJson('raffles');
        const idx = list.findIndex(r => r.id === req.params.id);
        if (idx === -1) {
            return res.sendStatus(404);
        }
        list[idx] = {
            ...list[idx],
            startDate: req.body.startDate,
            endDate: req.body.endDate,
            condition: {
                type: req.body.conditionType,
                value: req.body.conditionType === 'dealCount' ? req.body.dealCount : req.body.dealSum
            },
            prizes: req.body.prizes || [],
            timestamp: new Date().toISOString(),
            status: 'pending'
        };
        saveJson('raffles', list);
        if (req.raffleEmitter) {
            req.raffleEmitter.emit('updateRaffle');
        }
        res.json(list[idx]);
    } catch (err) {
        console.error('Error updating raffle:', err.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

router.delete('/raffles/:id', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    try {
        let list = loadJson('raffles');
        list = list.filter(x => x.id !== req.params.id);
        saveJson('raffles', list);
        res.sendStatus(204);
    } catch (err) {
        console.error('Error deleting raffle:', err.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = router;

