const express = require('express');
const { loadJson, saveJson } = require('../utils/storage-utils');
const { authenticateToken, restrictTo } = require('../middleware');
const { getBtcRubPrice } = require('../services/price-service');

const router = express.Router();

router.get('/config', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    const config = loadJson('config') || {};
    const { adminLogin, adminPassword, ...restConfig } = config;
    res.json(restConfig);
});

router.get('/config/credentials', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    const config = loadJson('config') || {};
    res.json({ login: config.adminLogin, password: config.adminPassword });
});

router.put('/config', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    const cfg = loadJson('config') || {};
    const { adminLogin, adminPassword } = cfg;
    const updatedConfig = {
        ...cfg,
        ...req.body,
        adminLogin,
        adminPassword,
        multipleOperatorsData: req.body.multipleOperatorsData ? req.body.multipleOperatorsData.map(item => {
            if (typeof item === 'object' && item.username) {
                return {
                    username: item.username,
                    currency: item.currency || 'BTC',
                    password: item.password || ''
                };
            }
            return { username: item, currency: 'BTC', password: '' };
        }) : cfg.multipleOperatorsData
    };
    saveJson('config', updatedConfig);
    res.json(updatedConfig);
});

router.put('/config/credentials', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    const { login, password } = req.body;
    const cfg = loadJson('config') || {};
    if (login && password) {
        cfg.adminLogin = login;
        cfg.adminPassword = password;
        saveJson('config', cfg);
        res.json({ message: 'Login and password updated' });
    } else {
        res.status(400).json({ error: 'Логин и пароль обязательны' });
    }
});

router.get('/btc-price', authenticateToken, restrictTo('mainAdmin', 'admin'), async (req, res) => {
    try {
        const price = await getBtcRubPrice();
        res.json({ price });
    } catch (error) {
        console.error('Error getting BTC price:', error);
        res.status(500).json({ error: 'Ошибка получения курса BTC' });
    }
});

function getBotStatus() {
    const config = loadJson('config') || {};
    return config.botStatus !== false;
}

function setBotStatus(status) {
    const config = loadJson('config') || {};
    config.botStatus = status;
    saveJson('config', config);
}

router.get('/bot/status', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    res.json({ botEnabled: getBotStatus() });
});

router.post('/bot/toggle', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'Неверный параметр enabled' });
    }

    if (getBotStatus() === enabled) {
        const statusText = enabled ? 'включен' : 'выключен';
        return res.status(400).json({ error: `Бот уже ${statusText}` });
    }

    setBotStatus(enabled);
    res.json({
        message: enabled ? 'Bot enabled' : 'Bot disabled',
        botEnabled: enabled
    });
});

module.exports = router;

