const { Telegraf } = require('telegraf');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

function loadJson(name) {
    const filePath = path.join(process.env.DATA_PATH, 'database', `${name}.json`);
    try {
        if (!fs.existsSync(filePath)) {
            return [];
        }
        return fs.readJsonSync(filePath);
    } catch (err) {
        return [];
    }
}

const bot = new Telegraf(process.env.SPAM_BOT_TOKEN, {
    telegram: { webhookReply: false },
});

const imagePath = path.join(__dirname, 'data/images/bit-check-image.png');
if (!fs.existsSync(imagePath)) {
    process.exit(1);
}

async function isAdmin(ctx) {
    try {
        const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
        return member.status === 'administrator' || member.status === 'creator';
    } catch (error) {
        return false;
    }
}

bot.on('message', async (ctx) => {
    if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') return;

    try {
        const chatId = ctx.chat.id;
        const messageId = ctx.message.message_id;

        if (ctx.message.new_chat_members) {
            await ctx.telegram.deleteMessage(chatId, messageId).catch(() => {});
            return;
        }

        if (ctx.message.left_chat_member) {
            await ctx.telegram.deleteMessage(chatId, messageId).catch(() => {});
            return;
        }

        if (ctx.message.text) {
            const messageText = ctx.message.text;

            if (/оператор/i.test(messageText)) {
                try {
                    const config = loadJson('config');
                    if (!config) {
                        return;
                    }

                    let inlineKeyboard = [];
                    if (config.multipleOperatorsMode) {
                        inlineKeyboard = config.multipleOperatorsData.map(operator => [{
                            text: `Написать оператору ${operator.currency}`,
                            url: `https://t.me/${operator.username}`,
                        }]);
                    } else {
                        inlineKeyboard = [[
                            {
                                text: 'Написать оператору',
                                url: `https://t.me/${config.singleOperatorUsername}`,
                            },
                        ]];
                    }

                    const sentMessage = await ctx.replyWithPhoto(
                        { source: imagePath },
                        {
                            caption: 'Для связи с оператором:',
                            reply_markup: {
                                inline_keyboard: inlineKeyboard,
                            },
                        }
                    );
                    const sentMessageId = sentMessage.message_id;

                    setTimeout(async () => {
                        try {
                            await ctx.telegram.deleteMessage(chatId, sentMessageId);
                        } catch (error) {}
                    }, 30 * 1000);
                } catch (error) {}
            }

            const linkRegex = /(?:t\.me\/|telegram\.me\/|tg:\/\/)[^\s]+/i;
            if (linkRegex.test(messageText)) {
                const allowedLink = 't.me/BitCheck_bot';
                if (messageText.includes(allowedLink)) {
                } else {
                    const isUserAdmin = await isAdmin(ctx);
                    if (!isUserAdmin) {
                        await ctx.telegram.deleteMessage(chatId, messageId).catch(() => {});
                    }
                }
            }

            const usernameRegex = /@[A-Za-z0-9_]{5,}/g;
            const usernames = messageText.match(usernameRegex) || [];
            if (usernames.length > 0) {
                const allowedUsernames = ['@BitCheck_exchange'];
                const hasDisallowedUsername = usernames.some((username) => !allowedUsernames.includes(username));

                if (hasDisallowedUsername) {
                    const isUserAdmin = await isAdmin(ctx);
                    if (!isUserAdmin) {
                        await ctx.telegram.deleteMessage(chatId, messageId).catch(() => {});
                    }
                }
            }
        }
    } catch (error) {}
});

bot.catch((err, ctx) => {});

bot.launch({
    dropPendingUpdates: true,
}).then(() => {}).catch((err) => {
    setTimeout(() => {
        bot.launch();
    }, 5000);
});

process.once('SIGINT', () => {
    bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
});