const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const bodyParser = require('body-parser');
const axios = require('axios');
const FormData = require('form-data');
const multer = require('multer');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const EventEmitter = require('events');

const app = express();
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/html', express.static(path.join(__dirname, 'public/html')));

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.MAIN_BOT_TOKEN}`;
const JWT_SECRET = process.env.JWT_SECRET;

const broadcastEmitter = new EventEmitter();

module.exports = { broadcastEmitter };

function getBotStatus() {
    const config = loadJson('config');
    return config.botStatus !== false;
}

function setBotStatus(status) {
    const config = loadJson('config');
    config.botStatus = status;
    saveJson('config', config);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(process.env.DATA_PATH, 'images/broadcasts-images');
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

function loadJson(name) {
    const filePath = path.join(process.env.DATA_PATH, 'database', `${name}.json`);
    try {
        if (!fs.existsSync(filePath)) {
            return [];
        }
        return fs.readJsonSync(filePath);
    } catch (err) {
        console.error(`Error loading ${name}.json:`, err.message);
        return [];
    }
}

function saveJson(name, data) {
    try {
        const filePath = path.join(process.env.DATA_PATH, 'database', `${name}.json`);
        fs.writeJsonSync(filePath, data, { spaces: 2 });
    } catch (err) {
        console.error(`Error saving ${name}.json:`, err.message);
    }
}

function sendHtmlFile(res, filePath) {
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        console.error(`File not found: ${filePath}`);
        res.status(404).send('Page not found. Check if the file exists in public/html.');
    }
}

function authenticateToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];

    console.log(req.url);
    console.log(token);

    if (!token) {
        if (req.originalUrl === '/') {
            return res.redirect('/login');
        }
        return res.status(401).json({ error: 'Токен не предоставлен' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Недействительный токен' });
        req.user = user;
        next();
    });
}

function restrictTo(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Доступ запрещен' });
        }
        next();
    };
}

app.post('/api/login', (req, res) => {
    const { login, password } = req.body;
    const config = loadJson('config');

    if (config.multipleOperatorsMode === false) {
        if (login === config.adminLogin && password === config.adminPassword) {
            const token = jwt.sign({ login, role: 'mainAdmin' }, JWT_SECRET, { expiresIn: '1h' });
            return res.json({ token, role: 'mainAdmin' });
        } else {
            return res.status(401).json({ error: 'В одиночном режиме доступ разрешен только главному администратору' });
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

    res.status(401).json({ error: 'Неверный логин или пароль' });
});

app.get('/api/user', authenticateToken, (req, res) => {
    try {
        res.json({
            role: req.user.role,
            currency: req.user.currency || null
        });
    } catch (err) {
        console.error('Ошибка получения данных пользователя:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/api/config', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    const config = loadJson('config');
    const { adminLogin, adminPassword, ...restConfig } = config;
    res.json(restConfig);
});

app.get('/api/config/credentials', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    const config = loadJson('config');
    res.json({ login: config.adminLogin, password: config.adminPassword });
});

app.put('/api/config', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
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

app.put('/api/config/credentials', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    const { login, password } = req.body;
    const cfg = loadJson('config');
    if (login && password) {
        cfg.adminLogin = login;
        cfg.adminPassword = password;
        saveJson('config', cfg);
        res.json({ message: 'Логин и пароль обновлены' });
    } else {
        res.status(400).json({ error: 'Логин и пароль обязательны' });
    }
});

app.get('/api/bot/status', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    res.json({ botEnabled: getBotStatus() });
});

app.post('/api/bot/toggle', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'Неверный параметр enabled' });
    }

    if (getBotStatus() === enabled) {
        const statusText = enabled ? 'включен' : 'отключен';
        return res.status(400).json({ error: `Бот уже ${statusText}` });
    }

    setBotStatus(enabled);
    res.json({
        message: enabled ? 'Бот включен' : 'Бот отключен',
        botEnabled: enabled
    });
});

app.get('/api/users', (req, res) => {
    res.json(loadJson('users'));
});

app.put('/api/users/:id', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    const users = loadJson('users');
    const idx = users.findIndex(u => u.id === +req.params.id);
    if (idx !== -1) {
        users[idx] = { ...users[idx], ...req.body };
        saveJson('users', users);
        return res.json(users[idx]);
    }
    res.sendStatus(404);
});

app.delete('/api/users/:id', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
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

app.get('/api/deals', authenticateToken, (req, res) => {
    let data = loadJson('deals');
    if (!Array.isArray(data)) {
        data = Object.values(data);
    }
    if (req.user.role === 'admin') {
        data = data.filter(d => d.currency === req.user.currency);
    }
    res.json(data);
});

app.post('/api/deals', authenticateToken, (req, res) => {
    const list = loadJson('deals');
    const item = {
        ...req.body,
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        rubAmount: req.body.rubAmount || req.body.amount,
        userId: req.body.userId || req.body.chatId
    };
    if (req.user.role === 'admin' && item.currency !== req.user.currency) {
        return res.status(403).json({ error: 'Недопустимая валюта для вашего аккаунта' });
    }
    list.push(item);
    saveJson('deals', list);
    res.status(201).json(item);
});

app.patch('/api/deals/:id/complete', authenticateToken, async (req, res) => {
    try {
        let deals = loadJson('deals');
        const idx = deals.findIndex(d => d.id === req.params.id);
        if (idx === -1) {
            return res.sendStatus(404);
        }
        if (req.user.role === 'admin' && deals[idx].currency !== req.user.currency) {
            return res.status(403).json({ error: 'Недопустимая валюта для вашего аккаунта' });
        }

        deals[idx] = { ...deals[idx], status: 'completed' };
        saveJson('deals', deals);

        const deal = deals[idx];
        const userId = deal.userId;
        const actionText = deal.type === 'buy' ? 'Покупка' : 'Продажа';
        const caption = `✅ Сделка завершена! №${deal.id}\n${actionText} ${deal.currency}\nКоличество: ${deal.cryptoAmount} ${deal.currency}\nСумма: ${deal.rubAmount} RUB\nКомиссия: ${deal.commission} Rub\nИтог: ${deal.total} RUB\nКошелёк: ${deal.walletAddress}`;

        const config = loadJson('config');
        const randomOperator = config.operatorUsernames[Math.floor(Math.random() * config.operatorUsernames.length)];
        const contactUrl = randomOperator?.startsWith('@') ? `https://t.me/${randomOperator.substring(1)}` : 'https://t.me/OperatorName';

        await (async () => {
            try {
                const form = new FormData();
                form.append('chat_id', userId);
                form.append('photo', fs.createReadStream(path.join(process.env.DATA_PATH, 'public/images/bit-check-image.png')));
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

                const users = loadJson('users');
                const referrer = users.find(u => u.referrals && u.referrals.includes(deal.userId));
                if (referrer) {
                    const referralCommissionRate = config.referralCommissionRate || 0.15;
                    const btcPrice = await (async () => {
                        try {
                            const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=rub', { timeout: 5000 });
                            return response.data.bitcoin.rub || 5000000;
                        } catch (error) {
                            console.error('Error fetching BTC price:', error.message);
                            return 5000000;
                        }
                    })();
                    const commissionBTC = (deal.commission / btcPrice) * referralCommissionRate;
                    const earningsRub = commissionBTC * btcPrice;

                    referrer.balance = (referrer.balance || 0) + Number(commissionBTC.toFixed(8));
                    saveJson('users', users);

                    try {
                        const form = new FormData();
                        form.append('chat_id', referrer.id);
                        form.append('photo', fs.createReadStream(path.join(process.env.DATA_PATH, 'public/images/bit-check-image.png')));
                        form.append('caption', `🎉 Реферальный бонус! +${commissionBTC.toFixed(8)} BTC (~${earningsRub.toFixed(2)}) за сделку ID ${deal.id}`);
                        await axios.post(`${TELEGRAM_API}/sendPhoto`, form, {
                            headers: form.getHeaders(),
                            timeout: 5000
                        });
                    } catch (error) {
                        console.error(`Error sending notification to referrer ${referrer.id}:`, error.message);
                    }
                }
            } catch (error) {
                console.error(`Error sending notification to user ${userId}:`, error.message);
            }
        })();

        return res.json(deals[idx]);
    } catch (error) {
        console.error('Error processing PATCH /api/deals/:id/complete:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.delete('/api/deals/:id', authenticateToken, (req, res) => {
    try {
        let deals = loadJson('deals');
        const deal = deals.find(d => d.id === req.params.id);
        if (!deal) {
            return res.sendStatus(404);
        }
        if (req.user.role === 'admin' && deal.currency !== req.user.currency) {
            return res.status(403).json({ error: 'Недопустимая валюта для вашего аккаунта' });
        }
        deals = deals.filter(d => d.id !== req.params.id);
        saveJson('deals', deals);
        res.sendStatus(204);
    } catch (err) {
        console.error('Error deleting deal:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/api/broadcasts', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    try {
        res.json(loadJson('broadcasts'));
    } catch (err) {
        console.error('Error fetching broadcasts:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/broadcasts', authenticateToken, restrictTo('mainAdmin'), upload.single('image'), (req, res) => {
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

app.delete('/api/broadcasts/:id', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    try {
        let list = loadJson('broadcasts');
        const broadcast = list.find(x => x.id === req.params.id);
        if (broadcast && broadcast.imageName) {
            const imagePath = path.join(process.env.DATA_PATH, 'public/images/broadcasts-images', broadcast.imageName);
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

app.get('/api/withdrawals', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    try {
        let data = loadJson('withdrawals');
        if (!Array.isArray(data)) {
            data = Object.values(data);
        }
        res.json(data);
    } catch (err) {
        console.error('Error fetching withdrawals:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/withdrawals', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    try {
        const list = loadJson('withdrawals');
        const item = {
            ...req.body,
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            rubAmount: req.body.rubAmount,
            userId: req.body.userId
        };
        list.push(item);
        saveJson('withdrawals', list);
        res.status(201).json(item);
    } catch (err) {
        console.error('Error creating withdrawal:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.patch('/api/withdrawals/:id/complete', authenticateToken, restrictTo('mainAdmin'), async (req, res) => {
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
        const randomOperator = config.operatorUsernames[Math.floor(Math.random() * config.operatorUsernames.length)];
        const contactUrl = randomOperator?.startsWith('@') ? `https://t.me/${randomOperator.substring(1)}` : 'https://t.me/OperatorName';

        try {
            const form = new FormData();
            form.append('chat_id', userId);
            form.append('photo', fs.createReadStream(path.join(process.env.DATA_PATH, 'public/images/bit-check-image.png')));
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
        console.error('Error processing PATCH /api/withdrawals/:id/complete:', error.message);
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

app.get('/referrals', (req, res) => {
    sendHtmlFile(res, path.join(__dirname, 'public/html/referrals.html'));
});

app.get('/analytics', (req, res) => {
    sendHtmlFile(res, path.join(__dirname, 'public/html/analytics.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));