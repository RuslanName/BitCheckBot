const { MESSAGES } = require('../../config');
const {
    getBtcRubPrice,
    calculateUserStats,
    buildProfileMessage,
    buildProfileReplyMarkup
} = require('../../services');
const { loadJson, saveJson, loadStates, sendBitCheckPhoto } = require('../../utils');

function registerSupportCallbacks(bot) {
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

            if (data === 'write_support') {
                const states = loadStates();
                try {
                    await ctx.deleteMessage(ctx.callbackQuery.message.message_id);
                } catch (error) {
                    console.error(`Error deleting message ${ctx.callbackQuery.message.message_id}:`, error.message);
                }

                states.pendingSupport[from] = {};
                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption: '✉️ Напишите:',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: MESSAGES.CANCEL_ACTION, callback_data: 'cancel_action' }]
                        ]
                    }
                });
                states.pendingSupport[from].messageId = message.message_id;
                saveJson('states', states);
                return;
            }

            if (data.startsWith('operator_reply_')) {
                const states = loadStates();
                const parts = data.split('_');
                if (parts.length < 3) {
                    await ctx.answerCbQuery(MESSAGES.ERROR_INVALID_DATA, { show_alert: true });
                    return;
                }
                const targetId = parseInt(parts[2]);
                if (states.pendingOperatorMessages[targetId]) {
                    for (const { operatorId, messageId } of states.pendingOperatorMessages[targetId]) {
                        await bot.telegram.deleteMessage(operatorId, messageId).catch(error => {
                            console.error(`Error deleting message ${messageId} for operator ${operatorId}:`, error.message);
                        });
                    }
                    delete states.pendingOperatorMessages[targetId];
                }
                const message = await sendBitCheckPhoto(ctx.chat.id, { caption: `✉️ Введите ответ для ID ${targetId}:` });
                states.pendingSupport[from] = { targetId, messageId: message.message_id };
                saveJson('states', states);
                return;
            }

            if (data === 'close_conv') {
                const states = loadStates();
                const targetIdMatch = ctx.callbackQuery.message.caption.match(/ID (\d+)/);
                const targetId = targetIdMatch ? parseInt(targetIdMatch[1]) : null;
                if (targetId && states.pendingOperatorMessages[targetId]) {
                    for (const { operatorId, messageId } of states.pendingOperatorMessages[targetId]) {
                        try {
                            await bot.telegram.deleteMessage(operatorId, messageId);
                        } catch (error) {
                            console.error(`Error deleting message ${messageId} for operator ${operatorId}:`, error.message);
                        }
                    }
                    delete states.pendingOperatorMessages[targetId];
                }
                await ctx.answerCbQuery('✅ Обращение закрыто', { show_alert: false });
                saveJson('states', states);
                return;
            }

            if (data === 'cancel_action') {
                const states = loadStates();
                const callbackMessageId = ctx.callbackQuery.message?.message_id;

                if (callbackMessageId) {
                    try {
                        await ctx.deleteMessage(callbackMessageId);
                    } catch (error) {
                        if (!error.message.includes('not found')) {
                            console.error(`Error deleting callback message ${callbackMessageId}:`, error.message);
                        }
                    }
                }

                const stateKeys = ['pendingDeal', 'pendingWithdrawal', 'pendingUpdateProfile', 'pendingSupport', 'pendingTransactionHash'];
                for (const key of stateKeys) {
                    if (states[key] && states[key][from] && states[key][from].messageId) {
                        const messageId = states[key][from].messageId;
                        if (messageId && messageId !== callbackMessageId) {
                            try {
                                await ctx.telegram.deleteMessage(ctx.chat.id, messageId);
                            } catch (error) {
                                if (!error.message.includes('not found') && !error.message.includes('Bad Request')) {
                                    console.error(`Error deleting message ${messageId}:`, error.message);
                                }
                            }
                        }
                    }
                }

                const users = loadJson('users') || [];
                const userIndex = users.findIndex(u => u.id === from);
                if (userIndex !== -1) {
                    users[userIndex].state = null;
                    saveJson('users', users);
                }

                const { clearPendingStates } = require('../../utils');
                clearPendingStates(states, from);
                saveJson('states', states);
                await ctx.answerCbQuery('❌ Действие отменено', { show_alert: false });
                return;
            }

            if (data === 'profile_back') {
                const states = loadStates() || {};
                const callbackMessageId = ctx.callbackQuery.message?.message_id;
                if (callbackMessageId) {
                    try { await ctx.deleteMessage(callbackMessageId); } catch(e) {}
                }

                if (states.pendingWithdrawal?.[from]) {
                    delete states.pendingWithdrawal[from];
                }
                saveJson('states', states);

                const users = loadJson('users') || [];
                const user = users.find(u => u.id === from);
                if (!user) {
                    await ctx.answerCbQuery(MESSAGES.CB_USER_NOT_FOUND, { show_alert: true });
                    return;
                }
                const priceBTC = await getBtcRubPrice();
                const stats = calculateUserStats(from);
                const referralLink = `https://t.me/${ctx.botInfo.username}?start=ref_${user.referralId}`;
                const profileText = buildProfileMessage(user, stats, priceBTC, referralLink);
                const replyMarkup = buildProfileReplyMarkup();

                const message = await sendBitCheckPhoto(ctx.chat.id, {
                    caption: profileText,
                    reply_markup: replyMarkup
                });
                states.pendingProfile = states.pendingProfile || {};
                states.pendingProfile[from] = { messageId: message.message_id };
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

module.exports = { registerSupportCallbacks };
