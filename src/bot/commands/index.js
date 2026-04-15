const { registerStartCommand } = require('./start');
const { registerSimpleCommands } = require('./simple');
const { registerBuyCommand, registerSellCommand } = require('./trade');

module.exports = {
    registerStartCommand,
    registerSimpleCommands,
    registerBuyCommand,
    registerSellCommand
};
