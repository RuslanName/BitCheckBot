const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const bodyParser = require('body-parser');
const axios = require('axios');
const FormData = require('form-data');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const EventEmitter = require('events');
const { loadJson, saveJson } = require('./tools/utils');
const { TELEGRAM_API, JWT_SECRET, DATA_PATH, PORT } = require('./tools/constants.js');

const app = express();

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/html', express.static(path.join(__dirname, 'public/html')));

const apiRouter = express.Router();
app.use('/api', apiRouter);

const broadcastEmitter = new EventEmitter();
const raffleEmitter = new EventEmitter();

function getBotStatus() {
    const config = loadJson('config');
    return config.botStatus !== false;
}

function setBotStatus(status) {
    const config = loadJson('config');
    config.botStatus = status;
    saveJson('config', config);
}

function getProcessingStatus() {
    const config = loadJson('config');
    return config.processingStatus !== false;
}

function setProcessingStatus(status) {
    const config = loadJson('config');
    config.processingStatus = status;
    saveJson('config', config);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(DATA_PATH, 'images/broadcasts');
        fs.ensureDirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') {
            return cb(new Error('Only PNG, JPG, and JPEG files are allowed'));
        }
        cb(null, true);
    },
    limits: { fileSize: 5 * 1024 * 1024 }
});

function sendHtmlFile(res, filePath) {
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        console.error(`File not found: ${filePath}`);
        res.status(404).json({ error: 'Page not found' });
    }
}

function authenticateToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];

    if (!token) {
        if (req.originalUrl === '/') {
            return res.redirect('/login');
        }
        return res.status(401).json({ error: 'Token not provided' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
}

function restrictTo(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        next();
    };
}

apiRouter.post('/login', (req, res) => {
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

apiRouter.get('/user', authenticateToken, (req, res) => {
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

apiRouter.get('/config', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    const config = loadJson('config');
    const { adminLogin, adminPassword, ...restConfig } = config;
    res.json(restConfig);
});

apiRouter.get('/config/credentials', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    const config = loadJson('config');
    res.json({ login: config.adminLogin, password: config.adminPassword });
});

apiRouter.put('/config', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    const cfg = loadJson('config');
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

apiRouter.put('/config/credentials', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    const { login, password } = req.body;
    const cfg = loadJson('config');
    if (login && password) {
        cfg.adminLogin = login;
        cfg.adminPassword = password;
        saveJson('config', cfg);
        res.json({ message: 'Login and password updated' });
    } else {
        res.status(400).json({ error: 'Login and password are required' });
    }
});

apiRouter.get('/bot/status', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    res.json({ botEnabled: getBotStatus() });
});

apiRouter.post('/bot/toggle', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'Invalid enabled parameter' });
    }

    if (getBotStatus() === enabled) {
        const statusText = enabled ? 'enabled' : 'disabled';
        return res.status(400).json({ error: `Bot is already ${statusText}` });
    }

    setBotStatus(enabled);
    res.json({
        message: enabled ? 'Bot enabled' : 'Bot disabled',
        botEnabled: enabled
    });
});

apiRouter.get('/processing/status', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    res.json({ processingEnabled: getProcessingStatus() });
});

apiRouter.post('/processing/toggle', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'Invalid enabled parameter' });
    }

    if (getProcessingStatus() === enabled) {
        const statusText = enabled ? 'enabled' : 'disabled';
        return res.status(400).json({ error: `Processing is already ${statusText}` });
    }

    setProcessingStatus(enabled);
    res.json({
        message: enabled ? 'Processing enabled' : 'Processing disabled',
        processingEnabled: enabled
    });
});

apiRouter.get('/users', (req, res) => {
    res.json(loadJson('users'));
});

apiRouter.put('/users/:id', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    const users = loadJson('users');
    const idx = users.findIndex(u => u.id === +req.params.id);
    if (idx !== -1) {
        users[idx] = { ...users[idx], ...req.body };
        saveJson('users', users);
        return res.json(users[idx]);
    }
    res.sendStatus(404);
});

apiRouter.delete('/users/:id', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
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
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

apiRouter.get('/deals', authenticateToken, async (req, res) => {
    try {
        let data = loadJson('deals');
        if (!Array.isArray(data)) {
            data = Object.values(data);
        }
        const { search } = req.query;
        const term = search ? search.trim().toLowerCase() : '';

        const users = loadJson('users');

        data = data.filter(d => {
            if (!d || d.status === 'draft') return false;
            const user = users.find(u => u.id === d.userId) || {};
            return (
                (d.id && d.id.toString().includes(term)) ||
                (d.userId && d.userId.toString().includes(term)) ||
                (user.username && user.username.toLowerCase().includes(term))
            );
        });

        if (req.user.role === 'admin') {
            data = data.filter(d => d.currency === req.user.currency);
        }

        res.json(data);
    } catch (err) {
        console.error('Error fetching deals:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

apiRouter.patch('/deals/:id/complete', authenticateToken, async (req, res) => {
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

apiRouter.delete('/deals/:id', authenticateToken, (req, res) => {
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

apiRouter.get('/broadcasts', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    try {
        res.json(loadJson('broadcasts'));
    } catch (err) {
        console.error('Error fetching broadcasts:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

apiRouter.post('/broadcasts', authenticateToken, restrictTo('mainAdmin'), upload.single('image'), (req, res) => {
    try {
        const list = loadJson('broadcasts') || [];
        const item = {
            id: Date.now().toString(),
            text: req.body.content,
            imageName: req.file ? req.file.filename : null,
            scheduledTime: req.body.scheduledTime || null,
            timestamp: new Date().toISOString(),
            isDaily: req.body.isDaily === 'true'
        };
        if (!item.isDaily) {
            item.status = 'pending';
        }
        list.push(item);
        saveJson('broadcasts', list);
        broadcastEmitter.emit('newBroadcast');
        res.status(201).json(item);
    } catch (err) {
        console.error('Error creating broadcast:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

apiRouter.put('/broadcasts/:id', authenticateToken, restrictTo('mainAdmin'), upload.single('image'), (req, res) => {
    try {
        let list = loadJson('broadcasts');
        const idx = list.findIndex(b => b.id === req.params.id);
        if (idx === -1) {
            return res.sendStatus(404);
        }

        const existingBroadcast = list[idx];
        const imagePath = existingBroadcast.imageName ? path.join(DATA_PATH, 'images/broadcasts', existingBroadcast.imageName) : null;
        if (req.file && imagePath && fs.existsSync(imagePath)) {
            fs.removeSync(imagePath);
        }

        list[idx] = {
            ...existingBroadcast,
            text: req.body.content || existingBroadcast.text,
            imageName: req.file ? req.file.filename : existingBroadcast.imageName,
            scheduledTime: req.body.scheduledTime || existingBroadcast.scheduledTime,
            timestamp: new Date().toISOString(),
            isDaily: req.body.isDaily === 'true'
        };

        if (!list[idx].isDaily) {
            list[idx].status = 'pending';
        }

        saveJson('broadcasts', list);
        broadcastEmitter.emit('updateBroadcast');
        res.json(list[idx]);
    } catch (err) {
        console.error('Error updating broadcast:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

apiRouter.delete('/broadcasts/:id', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    try {
        let list = loadJson('broadcasts');
        const broadcast = list.find(x => x.id === req.params.id);
        if (broadcast && broadcast.imageName) {
            const imagePath = path.join(DATA_PATH, 'images/broadcasts', broadcast.imageName);
            fs.removeSync(imagePath);
        }
        list = list.filter(x => x.id !== req.params.id);
        saveJson('broadcasts', list);
        res.sendStatus(204);
    } catch (err) {
        console.error('Error deleting broadcast:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

apiRouter.get('/raffles', authenticateToken, restrictTo('mainAdmin'), async (req, res) => {
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
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

apiRouter.post('/raffles', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
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
        raffleEmitter.emit('newRaffle');
        res.status(201).json(item);
    } catch (err) {
        console.error('Error creating raffle:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

apiRouter.put('/raffles/:id', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
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
        raffleEmitter.emit('updateRaffle');
        res.json(list[idx]);
    } catch (err) {
        console.error('Error updating raffle:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

apiRouter.delete('/raffles/:id', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    try {
        let list = loadJson('raffles');
        list = list.filter(x => x.id !== req.params.id);
        saveJson('raffles', list);
        res.sendStatus(204);
    } catch (err) {
        console.error('Error deleting raffle:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

apiRouter.get('/withdrawals', authenticateToken, restrictTo('mainAdmin'), async (req, res) => {
    try {
        let data = loadJson('withdrawals');
        if (!Array.isArray(data)) {
            data = Object.values(data);
        }

        const { search } = req.query;
        const term = search ? search.trim().toLowerCase() : '';

        const users = loadJson('users');
        data = data.filter(w => {
            if (!w || w.status === 'draft') return false;
            const user = users.find(u => u.id === w.userId) || {};
            return (
                (w.id && w.id.toString().includes(term)) ||
                (w.userId && w.userId.toString().includes(term)) ||
                (user.username && user.username.toLowerCase().includes(term))
            );
        });

        res.json(data);
    } catch (err) {
        console.error('Error fetching withdrawals:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

apiRouter.patch('/withdrawals/:id/complete', authenticateToken, restrictTo('mainAdmin'), async (req, res) => {
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
            await axios.post(`${TELEGRAM_API}/sendPhoto`, form, {
                headers: form.getHeaders(),
                timeout: 5000
            });
        } catch (error) {
            console.error(`Error sending withdrawal notification to user ${userId}:`, error.message);
        }

        res.json(withdrawals[idx]);
    } catch (error) {
        console.error('Error completing withdraw:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/login', (req, res) => {
    sendHtmlFile(res, path.join(__dirname, 'public/html/login.html'));
});

app.get('/', (req, res) => {
    sendHtmlFile(res, path.join(__dirname, 'public/html/index.html'));
});

app.get('/users', (req, res) => {
    sendHtmlFile(res, path.join(__dirname, 'public/html/users.html'));
});

app.get('/deals', (req, res) => {
    sendHtmlFile(res, path.join(__dirname, 'public/html/deals.html'));
});

app.get('/broadcasts', (req, res) => {
    sendHtmlFile(res, path.join(__dirname, 'public/html/broadcasts.html'));
});

app.get('/raffles', (req, res) => {
    sendHtmlFile(res, path.join(__dirname, 'public/html/raffles.html'));
});

app.get('/withdrawals', (req, res) => {
    sendHtmlFile(res, path.join(__dirname, 'public/html/withdrawals.html'));
});

app.get('/analytics', (req, res) => {
    sendHtmlFile(res, path.join(__dirname, 'public/html/analytics.html'));
});

const server = app.listen(PORT, () => console.log(`Server started on port ${PORT}`));

['SIGTERM', 'SIGINT'].forEach(signal =>
    process.on(signal, () => server.close(() => {}))
);

module.exports = { broadcastEmitter, raffleEmitter };