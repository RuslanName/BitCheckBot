const express = require('express');
const jwt = require('jsonwebtoken');
const { loadJson } = require('../utils/storage_utils');
const { JWT_SECRET } = require('../config/constants');
const { authenticateToken } = require('../middleware/auth_middleware');

const router = express.Router();

router.post('/login', (req, res) => {
    const { login, password } = req.body;
    const config = loadJson('config');

    if (config.multipleOperatorsMode === false) {
        if (login === config.adminLogin && password === config.adminPassword) {
            const token = jwt.sign({ login, role: 'mainAdmin' }, JWT_SECRET, { expiresIn: '1h' });
            return res.json({ token, role: 'mainAdmin' });
        } else {
            return res.status(401).json({ error: 'In single operator mode, only the main administrator has access' });
        }
    }

    if (login === config.adminLogin && password === config.adminPassword) {
        const token = jwt.sign({ login, role: 'mainAdmin' }, JWT_SECRET, { expiresIn: '1h' });
        return res.json({ token, role: 'mainAdmin' });
    }

    let operatorUsername = login.startsWith('@') ? login.substring(1) : login;
    const operatorData = config.multipleOperatorsData || [];

    const users = loadJson('users');
    const user = users.find(u => u.username === operatorUsername);
    if (user) {
        operatorUsername = user.username;
    }

    const operator = operatorData.find(a => a.username === operatorUsername && a.password === password);
    if (operator) {
        const token = jwt.sign({ login: operatorUsername, role: 'admin', currency: operator.currency }, JWT_SECRET, { expiresIn: '1h' });
        return res.json({ token, role: 'admin', currency: operator.currency });
    }

    res.status(401).json({ error: 'Invalid login or password' });
});

router.get('/user', authenticateToken, (req, res) => {
    try {
        res.json({
            role: req.user.role,
            currency: req.user.currency || null
        });
    } catch (err) {
        console.error('Error fetching user data:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;

