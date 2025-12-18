const authRoutes = require('./auth_routes');
const configRoutes = require('./config_routes');
const userRoutes = require('./user_routes');
const dealRoutes = require('./deal_routes');
const { router: broadcastRoutes, upload } = require('./broadcast_routes');
const raffleRoutes = require('./raffle_routes');
const withdrawalRoutes = require('./withdrawal_routes');

module.exports = {
    authRoutes,
    configRoutes,
    userRoutes,
    dealRoutes,
    broadcastRoutes,
    upload,
    raffleRoutes,
    withdrawalRoutes
};




