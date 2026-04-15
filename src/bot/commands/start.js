const { sendBitCheckPhoto, generateCaptcha, loadStates, saveJson, clearPendingStates } = require('../../utils');
const { loadJson } = require('../../utils');
const { calculateUserStats, getBtcRubPrice } = require('../../services');
const { MESSAGES } = require('../../config');

function registerStartCommand(bot) {
    bot.command('start', async ctx => {
        const users = loadJson('users') || [];
        const states = loadStates() || {};
        const userId = ctx.from.id;
        
        if (!ctx.message || !ctx.message.text) {
            return;
        }
        
        const args = ctx.message.text.split(' ');
        let invitedBy = null;

        if (args.length > 1 && args[1].startsWith('ref_')) {
            const refParts = args[1].split('_');
            const referralId = refParts.length > 1 ? refParts[1] : null;
            if (referralId) {
                const referrer = users.find(u => u.referralId === referralId);
                if (referrer && referrer.id !== userId) invitedBy = referrer.id;
            }
        }

        let user = users.find(u => u.id === userId);
        if (!user) {
            const captcha = await generateCaptcha();
            const captchaMessage = await ctx.replyWithPhoto(
                { source: Buffer.from(captcha.data) },
                { caption: MESSAGES.CAPTCHA_INPUT }
            );
            states.pendingCaptcha[userId] = {
                correct: captcha.text,
                invitedBy,
                messageId: captchaMessage.message_id
            };
        } else {
            await sendBitCheckPhoto(ctx.chat.id, {
                caption: `BitCheck — быстрый и надёжный криптообменник 🚀

Покупайте и продавайте криптовалюту без лишних сложностей:
— мгновенные сделки ⚡
— выгодные курсы 💱
— поддержку популярных валют (BTC, LTC, XMR)

💼 Сохраняйте свои кошельки и используйте их в один клик
💰 Зарабатывайте на реферальной программе
📞 Получайте помощь от поддержки в любой момент

Выберите действие ниже 👇`,
                reply_markup: {
                    keyboard: [['💰 Купить', '💸 Продать'], ['👤 Профиль', '📞 Контакты'], ['📋 Прочее']],
                    resize_keyboard: true
                }
            });
        }
        saveJson('states', states);
    });
}

async function handleCaptchaResponse(ctx, users, states, saveJson) {
    const id = ctx.from.id;
    
    if (!states.pendingCaptcha[id] || !ctx.message || !ctx.message.text) {
        return false;
    }
    
    const captchaData = states.pendingCaptcha[id];
    const userInput = ctx.message.text.trim().toUpperCase();
    const correctCaptcha = captchaData.correct.toUpperCase();

    try {
        await ctx.deleteMessage(captchaData.messageId);
    } catch (error) {
        console.error(`Error deleting CAPTCHA message:`, error.message);
    }

    if (userInput === correctCaptcha) {
        const invitedBy = captchaData.invitedBy;
        let user = users.find(u => u.id === id);
        
        if (!user) {
            if (invitedBy) {
                const referrer = users.find(u => u.id === invitedBy);
                if (referrer && !referrer.referrals.includes(id)) {
                    referrer.referrals = referrer.referrals || [];
                    referrer.referrals.push(id);
                    try {
                        const { sendBitCheckPhoto } = require('../../utils');
                        await sendBitCheckPhoto(referrer.id, { caption: `👥 ${ctx.from.first_name || 'Пользователь'} приглашён!` });
                    } catch (error) {
                        const { shouldLogSendError } = require('../../utils');
                        if (shouldLogSendError(error)) {
                            console.error(`Error sending notification to referrer ${referrer.id}:`, error.message);
                        }
                    }
                }
            }
            user = {
                id: id,
                username: ctx.from.username || '',
                first_name: ctx.from.first_name || '',
                last_name: ctx.from.last_name || '',
                referralId: Date.now().toString(),
                referrals: [],
                balance: 0,
                isBlocked: false,
                registrationDate: new Date().toISOString(),
                defaultWalletsBTC: [],
                defaultWalletsLTC: [],
                defaultRequisites: []
            };
            users.push(user);
        }
        
        delete states.pendingCaptcha[id];
        await ctx.reply(MESSAGES.CAPTCHA_SUCCESS);

        const { calculateUserStats, getBtcRubPrice } = require('../../services');
        const priceBTC = await getBtcRubPrice();
        const stats = calculateUserStats(id);
        const earningsRub = (user.balance || 0) * priceBTC;
        const username = user.username ? `@${user.username}` : 'Нет';
        const referralLink = `https://t.me/${ctx.botInfo.username}?start=ref_${user.referralId}`;
        const profileText = `👤 Твой профиль в BitCheck\n` +
            `📛 Имя: ${username}\n` +
            `🆔 ID: ${id}\n\n` +
            `📦 Статистика:\n` +
            `🔄 Сделок совершено: ${stats.dealsCount}\n` +
            `👥 Приведено рефералов: ${(user.referrals || []).length}\n` +
            `💸 Реферальный заработок: ${(user.balance).toFixed(8)} BTC (~${earningsRub.toFixed(2)} RUB)\n\n` +
            `📥 Куплено:\n` +
            `₿ BTC: ${stats.boughtBTC.rub.toFixed(2)} RUB (${stats.boughtBTC.crypto.toFixed(8)} BTC)\n` +
            `Ł LTC: ${stats.boughtLTC.rub.toFixed(2)} RUB (${stats.boughtLTC.crypto.toFixed(8)} LTC)\n\n` +
            `📤 Продано:\n` +
            `₿ BTC: ${stats.soldBTC.rub.toFixed(2)} RUB (${stats.soldBTC.crypto.toFixed(8)} BTC)\n` +
            `Ł LTC: ${stats.soldLTC.rub.toFixed(2)} RUB (${stats.soldLTC.crypto.toFixed(8)} LTC)\n\n` +
            `🔗 Твоя ссылка:\n` +
            `👉 ${referralLink}\n` +
            `💰 Приглашайте друзей и получайте бонусы!\n\n`;
        
        await sendBitCheckPhoto(ctx.chat.id, {
            caption: profileText,
            reply_markup: {
                keyboard: [['💰 Купить', '💸 Продать'], ['👤 Профиль', '📞 Контакты'], ['📋 Прочее']],
                resize_keyboard: true
            }
        });
        
        saveJson('users', users);
        saveJson('states', states);
        return true;
    } else {
        const captcha = await generateCaptcha();
        const captchaMessage = await ctx.replyWithPhoto(
            { source: Buffer.from(captcha.data) },
            { caption: MESSAGES.ERROR_INVALID_CAPTCHA }
        );
        states.pendingCaptcha[id] = {
            correct: captcha.text,
            invitedBy: captchaData.invitedBy,
            messageId: captchaMessage.message_id
        };
        saveJson('states', states);
        return true;
    }
}

module.exports = {
    registerStartCommand,
    handleCaptchaResponse
};
