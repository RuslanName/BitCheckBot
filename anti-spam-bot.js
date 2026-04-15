const { Telegraf } = require('telegraf');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();
const BIT_CHECK_OPERATOR_URL = 'https://t.me/BitCheck_exchange2';
const BIT_CHECK_SUPPORT_URL = 'https://t.me/BitCheck_exchange123';
const BIT_CHECK_ADS_URL = 'https://t.me/BitCneck001';
const ASSETS_PATH = process.env.ASSETS_PATH ? process.env.ASSETS_PATH.replace(/\/$/, '') + '/' : './assets/';
const BIT_CHECK_IMAGE_PATH = path.join(ASSETS_PATH, 'images/bit-check-image.png');

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

const spam_bot = new Telegraf(process.env.SPAM_BOT_TOKEN, {
    telegram: { webhookReply: false },
});

const imagePath = BIT_CHECK_IMAGE_PATH;
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

spam_bot.on('message', async (ctx) => {
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
                    const sentMessage = await ctx.replyWithPhoto(
                        { source: imagePath },
                        {
                            caption: '💬 Напишите оператору для связи:',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: 'Написать оператору ✍️', url: `${BIT_CHECK_OPERATOR_URL}` }],
                                    [
                                        { text: '🛠 Техподдержка', url: `${BIT_CHECK_SUPPORT_URL}` },
                                        { text: '📣 Реклама', url: `${BIT_CHECK_ADS_URL}` }
                                    ]
                                ],
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
    } catch (error) {
        console.log(error);
    }
});

spam_bot.launch().then(() => {
    console.log('Bot started');
}).catch(err => {
    console.error('Error launching bot:', err.message);
});

process.once('SIGINT', () => {
    spam_bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
    spam_bot.stop('SIGTERM');
});