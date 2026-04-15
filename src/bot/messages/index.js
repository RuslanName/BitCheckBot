const { registerUserStateMessages } = require('./user-state-messages');
const { registerDealFlowMessages } = require('./deal-flow-messages');
const { registerWithdrawalMessages } = require('./withdrawal-messages');

function registerAllMessages(bot) {
    registerUserStateMessages(bot);
    registerDealFlowMessages(bot);
    registerWithdrawalMessages(bot);
}

module.exports = { registerAllMessages };
