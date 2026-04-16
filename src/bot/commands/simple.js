const { sendBitCheckPhoto, loadStates, saveJson } = require('../../utils');
const { loadJson } = require('../../utils');
const { 
    calculateUserStats, 
    getBtcRubPrice, 
    buildProfileMessage, 
    buildProfileReplyMarkup
} = require('../../services');
const { MESSAGES } = require('../../config');

function registerSimpleCommands(bot) {
    bot.hears('📞 Контакты', async ctx => {
        const config = loadJson('config') || {};
        await sendBitCheckPhoto(ctx.chat.id, {
            caption: '📞 Наши актуальные контакты:\nВыберите нужный раздел ниже.',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💬 Чат', url: `${config.bitCheckChatUrl}` }, { text: '📰 Новости', url: `${config.bitCheckNewsUrl}` }],
                    [{ text: '👤 Оператор', url: `${config.bitCheckOperatorUrl}` }, { text: '🛠 Техподдержка', url: `${config.bitCheckSupportUrl}` }],
                    [{ text: '📢 Реклама', url: `${config.bitCheckAdsUrl}` }, { text: '⭐ Отзывы', url: `${config.bitCheckReviewUrl}` }]
                ]
            }
        });
    });

    bot.hears('📋 Прочее', async ctx => {
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

        const message = await sendBitCheckPhoto(ctx.chat.id, {
            caption: MESSAGES.OTHER_MENU_TEXT,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '♻️ Обновить реквизиты', callback_data: 'update_requisites' }],
                    [{ text: '💸 Зарабатывай с нами', callback_data: 'earn_money' }],
                    [{ text: '📜 Правила', callback_data: 'show_rules' }]
                ]
            }
        });
        states.pendingOther = states.pendingOther || {};
        states.pendingOther[ctx.from.id] = { messageId: message.message_id };
        saveJson('states', states);
    });

    bot.hears('👤 Профиль', async ctx => {
        const users = loadJson('users') || [];
        const userId = ctx.from.id;
        const user = users.find(u => u.id === userId);
        if (!user) {
            await sendBitCheckPhoto(ctx.chat.id, { caption: MESSAGES.ERROR_NOT_REGISTERED });
            return;
        }
        const priceBTC = await getBtcRubPrice();
        const stats = calculateUserStats(userId);
        const referralLink = `https://t.me/${ctx.botInfo.username}?start=ref_${user.referralId}`;
        const profileText = buildProfileMessage(user, stats, priceBTC, referralLink);
        const replyMarkup = buildProfileReplyMarkup();

        const message = await sendBitCheckPhoto(ctx.chat.id, {
            caption: profileText,
            reply_markup: replyMarkup
        });
        const states = loadJson('states') || {};
        states.pendingProfile = states.pendingProfile || {};
        states.pendingProfile[userId] = { messageId: message.message_id };
        saveJson('states', states);
    });

}

module.exports = {
    registerSimpleCommands
};
