const { sendBitCheckPhoto, loadStates, saveJson } = require('../../utils');
const { loadJson } = require('../../utils');
const { 
    getBtcRubPrice, 
    getLtcRubPrice, 
    getXmrRubPrice,
    calculateMinMaxAmounts,
    calculateSellMinMaxAmounts,
    buildBuyMenuMessage,
    buildBuyMenuReplyMarkup,
    buildSellMenuMessage,
    buildSellMenuReplyMarkup
} = require('../../services');
const { MESSAGES } = require('../../config');

function registerBuyCommand(bot) {
    bot.hears('💰 Купить', async ctx => {
        try {
            const config = loadJson('config') || {};
            const states = loadStates() || {};

            const users = loadJson('users') || [];
            const userIndex = users.findIndex(u => u.id === ctx.from.id);
            if (userIndex !== -1) {
                users[userIndex].state = null;
                saveJson('users', users);
            }

            if (states.pendingDeal[ctx.from.id]) {
                delete states.pendingDeal[ctx.from.id];
            }
            if (states.pendingWithdrawal[ctx.from.id]) {
                delete states.pendingWithdrawal[ctx.from.id];
            }
            saveJson('states', states);

            if (!config.minBuyAmountRubBTC || !config.maxBuyAmountRubBTC ||
                !config.minBuyAmountRubLTC || !config.maxBuyAmountRubLTC ||
                !config.minBuyAmountRubXMR || !config.maxBuyAmountRubXMR) {
                await sendBitCheckPhoto(ctx.chat.id, { caption: MESSAGES.ERROR_CONFIG });
                return;
            }

            const priceBTC = await getBtcRubPrice();
            const priceLTC = await getLtcRubPrice();
            const priceXMR = await getXmrRubPrice();

            const btcAmounts = calculateMinMaxAmounts('BTC', config, priceBTC, priceLTC, priceXMR, false);
            const ltcAmounts = calculateMinMaxAmounts('LTC', config, priceBTC, priceLTC, priceXMR, false);
            const xmrAmounts = calculateMinMaxAmounts('XMR', config, priceBTC, priceLTC, priceXMR, false);

            states.pendingDeal[ctx.from.id] = { type: 'buy', messageId: null };
            const caption = buildBuyMenuMessage(config, priceBTC, priceLTC, priceXMR, btcAmounts, ltcAmounts, xmrAmounts, false);

            const replyMarkup = buildBuyMenuReplyMarkup();
            const message = await sendBitCheckPhoto(ctx.chat.id, { caption, reply_markup: replyMarkup });
            states.pendingDeal[ctx.from.id].messageId = message.message_id;
            saveJson('states', states);
        } catch (error) {
            console.error('Buy command error:', error.message);
            await sendBitCheckPhoto(ctx.chat.id, { caption: MESSAGES.ERROR_TRADE_COMMAND(error.message) });
        }
    });
}

function registerSellCommand(bot) {
    bot.hears('💸 Продать', async ctx => {
        try {
            const config = loadJson('config') || {};
            const states = loadStates() || {};

            const users = loadJson('users') || [];
            const userIndex = users.findIndex(u => u.id === ctx.from.id);
            if (userIndex !== -1) {
                users[userIndex].state = null;
                saveJson('users', users);
            }

            if (states.pendingDeal[ctx.from.id]) {
                delete states.pendingDeal[ctx.from.id];
            }
            if (states.pendingWithdrawal[ctx.from.id]) {
                delete states.pendingWithdrawal[ctx.from.id];
            }
            saveJson('states', states);

            if (!config.minSellAmountRubBTC || !config.maxSellAmountRubBTC ||
                !config.minSellAmountRubLTC || !config.maxSellAmountRubLTC ||
                !config.minSellAmountRubXMR || !config.maxSellAmountRubXMR) {
                await sendBitCheckPhoto(ctx.chat.id, { caption: MESSAGES.ERROR_CONFIG });
                return;
            }

            const priceBTC = await getBtcRubPrice();
            const priceLTC = await getLtcRubPrice();
            const priceXMR = await getXmrRubPrice();

            const btcAmounts = calculateSellMinMaxAmounts('BTC', config, priceBTC, priceLTC, priceXMR);
            const ltcAmounts = calculateSellMinMaxAmounts('LTC', config, priceBTC, priceLTC, priceXMR);
            const xmrAmounts = calculateSellMinMaxAmounts('XMR', config, priceBTC, priceLTC, priceXMR);

            states.pendingDeal[ctx.from.id] = { type: 'sell', messageId: null };
            const caption = buildSellMenuMessage(config, btcAmounts, ltcAmounts, xmrAmounts);

            const replyMarkup = buildSellMenuReplyMarkup();
            const message = await sendBitCheckPhoto(ctx.chat.id, { caption, reply_markup: replyMarkup });
            states.pendingDeal[ctx.from.id].messageId = message.message_id;
            saveJson('states', states);
        } catch (error) {
            console.error('Sell command error:', error.message);
            await sendBitCheckPhoto(ctx.chat.id, { caption: MESSAGES.ERROR_TRADE_COMMAND(error.message) });
        }
    });
}

module.exports = {
    registerBuyCommand,
    registerSellCommand
};
