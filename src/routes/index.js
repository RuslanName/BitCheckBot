const authRoutes = require('./auth-routes');
const configRoutes = require('./config-routes');
const userRoutes = require('./user-routes');
const dealRoutes = require('./deal-routes');
const { router: broadcastRoutes, upload } = require('./broadcast-routes');
const raffleRoutes = require('./raffle-routes');
const withdrawalRoutes = require('./withdrawal-routes');
const analyticsRoutes = require('./analytics-routes');
const cashbackRoutes = require('./cashback-routes');

module.exports = {
    authRoutes,
    configRoutes,
    userRoutes,
    dealRoutes,
    broadcastRoutes,
    upload,
    raffleRoutes,
    withdrawalRoutes,
    analyticsRoutes,
    cashbackRoutes
};

