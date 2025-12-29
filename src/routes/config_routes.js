const express = require('express');
const { loadJson, saveJson } = require('../utils/storage_utils');
const { authenticateToken, restrictTo } = require('../middleware/auth_middleware');

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

function getBotStatus() {
    const config = loadJson('config') || {};
    return config.botStatus !== false;
}

function setBotStatus(status) {
    const config = loadJson('config') || {};
    config.botStatus = status;
    saveJson('config', config);
}

function getProcessingStatus() {
    const config = loadJson('config') || {};
    const processingType = config.processingType || 'none';
    return processingType !== 'none';
}

function getProcessingType() {
    const config = loadJson('config') || {};
    return config.processingType || 'none';
}

function setProcessingType(type) {
    const config = loadJson('config') || {};
    if (!['none', 'ros_trust_processing', 'settlex_processing'].includes(type)) {
        throw new Error('Неверный тип процессинга');
    }
    config.processingType = type;
    config.processingStatus = type !== 'none';
    saveJson('config', config);
}

function setProcessingStatus(status) {
    const config = loadJson('config') || {};
    if (status) {
        if (!config.processingType || config.processingType === 'none') {
            config.processingType = 'ros_trust_processing';
        }
    } else {
        config.processingType = 'none';
    }
    config.processingStatus = status;
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

router.get('/processing/status', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    res.json({ 
        processingEnabled: getProcessingStatus(),
        processingType: getProcessingType()
    });
});

router.post('/processing/toggle', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'Неверный параметр enabled' });
    }

    if (getProcessingStatus() === enabled) {
        const statusText = enabled ? 'включен' : 'выключен';
        return res.status(400).json({ error: `Процессинг уже ${statusText}` });
    }

    setProcessingStatus(enabled);
    res.json({
        message: enabled ? 'Processing enabled' : 'Processing disabled',
        processingEnabled: enabled,
        processingType: getProcessingType()
    });
});

router.post('/processing/type', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    const { type } = req.body;

    if (!['none', 'ros_trust_processing', 'settlex_processing'].includes(type)) {
        return res.status(400).json({ error: 'Неверный тип процессинга. Должен быть: none, ros_trust_processing или settlex_processing' });
    }

    try {
        setProcessingType(type);
        res.json({
            message: `Processing type set to ${type}`,
            processingType: type,
            processingEnabled: type !== 'none'
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;

