const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const bodyParser = require('body-parser');
const EventEmitter = require('events');
const { PORT, WEBHOOK_DOMAIN } = require('./src/config/constants');

const app = express();

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/html', express.static(path.join(__dirname, 'public/html')));

const apiRouter = express.Router();
app.use('/api', apiRouter);

const broadcastEmitter = new EventEmitter();
const raffleEmitter = new EventEmitter();

const { authRoutes, configRoutes, userRoutes, dealRoutes, broadcastRoutes, raffleRoutes, withdrawalRoutes } = require('./src/routes');

const setupBroadcastRoutes = (router, emitter) => {
    router.use((req, res, next) => {
        req.broadcastEmitter = emitter;
        next();
    });
    return router;
};

const setupRaffleRoutes = (router, emitter) => {
    router.use((req, res, next) => {
        req.raffleEmitter = emitter;
        next();
    });
    return router;
};

apiRouter.use(authRoutes);
apiRouter.use(configRoutes);
apiRouter.use(userRoutes);
apiRouter.use(dealRoutes);
apiRouter.use(setupBroadcastRoutes(broadcastRoutes, broadcastEmitter));
apiRouter.use(setupRaffleRoutes(raffleRoutes, raffleEmitter));
apiRouter.use(withdrawalRoutes);

function sendHtmlFile(res, filePath) {
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        console.error(`File not found: ${filePath}`);
        res.status(404).json({ error: 'Page not found' });
    }
}

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

let mainBot = null;
const initBot = async () => {
    const mainBotModule = require('./main_bot');
    mainBot = mainBotModule.getBot();
    
    const webhookUrl = `https://${WEBHOOK_DOMAIN}/webhook/telegram`;
    try {
        await mainBot.telegram.setWebhook(webhookUrl);
    } catch (error) {
        console.error('Error setting webhook:', error.message);
    }
};

app.post('/webhook/telegram', async (req, res) => {
    if (!mainBot) {
        return res.status(503).send('Bot not initialized');
    }
    
    try {
        await mainBot.handleUpdate(req.body);
        res.sendStatus(200);
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).send('Internal Server Error');
    }
});

app.get('/webhook/telegram/info', async (req, res) => {
    if (!mainBot) {
        return res.status(503).json({ error: 'Bot not initialized' });
    }
    
    try {
        const webhookInfo = await mainBot.telegram.getWebhookInfo();
        res.json(webhookInfo);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const server = app.listen(PORT, async () => {
    console.log(`Server started on port ${PORT}`);
    await initBot();
});

async function shutdown() {    
    if (mainBot) {
        try {
            const mainBotModule = require('./main_bot');
            await mainBotModule.stopBot();
        } catch (error) {
            console.error('Error stopping bot:', error);
        }
    }
    
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
    
    setTimeout(() => {
        console.error('Forced shutdown');
        process.exit(1);
    }, 10000);
}

['SIGTERM', 'SIGINT'].forEach(signal =>
    process.once(signal, shutdown)
);

module.exports = { broadcastEmitter, raffleEmitter };
