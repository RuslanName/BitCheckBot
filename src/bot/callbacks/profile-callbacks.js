const { MESSAGES } = require('../../config');
const { getBtcRubPrice } = require('../../services');
const { loadJson, saveJson, loadStates, sendBitCheckPhoto } = require('../../utils');

function registerProfileCallbacks(bot) {
    bot.on('callback_query', async (ctx, next) => {
        const data = ctx.callbackQuery.data;
        const from = ctx.from.id;

        try {
            if (!data) {
                await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                return next();
            }

            const deals = loadJson('deals') || [];
            const withdrawals = loadJson('withdrawals') || [];

            if (data === 'cashback_withdraw') {
                const states = loadStates() || {};
                const pendingProfile = states.pendingProfile?.[from];
                if (pendingProfile?.messageId) {
                    try { await ctx.deleteMessage(pendingProfile.messageId); } catch(e) {}
                }

                const users = loadJson('users') || [];
                const user = users.find(u => u.id === from);
                const balance = user?.cashback || 0;
                if (!user || !balance) {
                    await ctx.answerCbQuery('У вас нет кешбэка', { show_alert: true });
                    return;
                }
                if (balance < 500) {
                    await ctx.answerCbQuery(MESSAGES.CB_MIN_AMOUNT, { show_alert: true });
                    return;
                }
                states.pendingWithdrawal = states.pendingWithdrawal || {};
                states.pendingWithdrawal[from] = { type: 'wd_cashback_amt', balance: balance };
                saveJson('states', states);
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption: `💰 Введите сумму для вывода.\nДоступно: ${balance.toFixed(2)} RUB\nМин: 500 RUB`,
                    reply_markup: { inline_keyboard: [[{ text: MESSAGES.CB_BACK, callback_data: 'profile_back' }], [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]] }
                });
                states.pendingWithdrawal[from].messageId = message.message_id;
                saveJson('states', states);
                await ctx.answerCbQuery();
                return;
            }

            if (data === 'withdraw_referral') {
                const states = loadStates() || {};
                const pendingProfile = states.pendingProfile?.[from];
                if (pendingProfile?.messageId) {
                    try { await ctx.deleteMessage(pendingProfile.messageId); } catch(e) {}
                }

                const users = loadJson('users') || [];
                const user = users.find(u => u.id === from);
                const priceBTC = await getBtcRubPrice();
                const balanceCrypto = user?.balance || 0;
                const balanceRub = balanceCrypto * priceBTC;
                if (!user || !balanceCrypto) {
                    await ctx.answerCbQuery('У вас нет реферальных', { show_alert: true });
                    return;
                }
                if (balanceRub < 500) {
                    await ctx.answerCbQuery(MESSAGES.CB_MIN_AMOUNT, { show_alert: true });
                    return;
                }
                states.pendingWithdrawal = states.pendingWithdrawal || {};
                states.pendingWithdrawal[from] = { type: 'wd_referral_amt', balance: balanceRub, balanceRub: balanceRub };
                saveJson('states', states);
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption: `💸 Введите сумму для вывода.\nДоступно: ${balanceRub.toFixed(2)} RUB\nМин: 500 RUB`,
                    reply_markup: { inline_keyboard: [[{ text: MESSAGES.CB_BACK, callback_data: 'profile_back' }], [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]] }
                });
                states.pendingWithdrawal[from].messageId = message.message_id;
                saveJson('states', states);
                await ctx.answerCbQuery();
                return;
            }
            await next();
        } catch (error) {
            console.error('Error processing callback query:', error.message);
            if (error.stack) {
                console.error('Stack:', error.stack);
            }
            try {
                await ctx.answerCbQuery('❌ Ошибка обработки', { show_alert: true });
            } catch (answerError) {
                console.error('Error answering callback query:', answerError.message);
            }
        }
    });
}

module.exports = { registerProfileCallbacks };
