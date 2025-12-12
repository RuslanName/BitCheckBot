const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const bodyParser = require('body-parser');
const EventEmitter = require('events');
const { PORT } = require('./src/config/constants');

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

const server = app.listen(PORT, () => console.log(`Server started on port ${PORT}`));

['SIGTERM', 'SIGINT'].forEach(signal =>
    process.on(signal, () => server.close(() => {}))
);

module.exports = { broadcastEmitter, raffleEmitter };
