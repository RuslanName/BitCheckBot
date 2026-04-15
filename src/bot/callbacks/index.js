const { registerMenuCallbacks } = require('./menu-callbacks');
const { registerProfileCallbacks } = require('./profile-callbacks');
const { registerRequisitesCallbacks } = require('./requisites-callbacks');
const { registerDealCallbacks } = require('./deal-callbacks');
const { registerSupportCallbacks } = require('./support-callbacks');

function registerAllCallbacks(bot) {
    registerMenuCallbacks(bot);
    registerProfileCallbacks(bot);
    registerRequisitesCallbacks(bot);
    registerDealCallbacks(bot);
    registerSupportCallbacks(bot);
}

module.exports = { registerAllCallbacks };
