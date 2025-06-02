const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const logStream = fs.createWriteStream(path.join(__dirname, 'spam_bot.log'), { flags: 'a' });
const log = (...args) => {
    const message = `${new Date().toISOString()} - ${args.join(' ')}`;
    logStream.write(`${message}\n`);
    console.log(message);
};

const bot = new Telegraf(process.env.SPAM_BOT_TOKEN, {
    telegram: { webhookReply: false },
});

const imagePath = path.join(__dirname, 'public/images/bit-check-image.png');
if (!fs.existsSync(imagePath)) {
    log(`Error: Image file not found at ${imagePath}`);
    process.exit(1);
}

async function isAdmin(ctx) {
    try {
        const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
        return member.status === 'administrator' || member.status === 'creator';
    } catch (error) {
        log(`Error checking admin status for userId=${ctx.from.id}: ${error.message}`);
        return false;
    }
}

bot.on('message', async (ctx) => {
    if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') return;

    try {
        const chatId = ctx.chat.id;
        const messageId = ctx.message.message_id;

        if (ctx.message.new_chat_members) {
            await ctx.telegram.deleteMessage(chatId, messageId).catch((err) => {
                log(`Error deleting join message: chatId=${chatId}, messageId=${messageId}, error=${err.message}`);
            });
            log(`Deleted join message: chatId=${chatId}, messageId=${messageId}`);
            return;
        }

        if (ctx.message.left_chat_member) {
            await ctx.telegram.deleteMessage(chatId, messageId).catch((err) => {
                log(`Error deleting leave message: chatId=${chatId}, messageId=${messageId}, error=${err.message}`);
            });
            log(`Deleted leave message: chatId=${chatId}, messageId=${messageId}`);
            return;
        }

        if (ctx.message.text) {
            const messageText = ctx.message.text;

            if (/оператор/i.test(messageText)) {
                try {
                    const sentMessage = await ctx.replyWithPhoto(
                        { source: imagePath },
                        {
                            caption: 'Для связи с оператором:',
                            reply_markup: {
                                inline_keyboard: [
                                    [
                                        {
                                            text: 'Написать оператору',
                                            url: 'https://t.me/BitCheck_exchange',
                                        },
                                    ],
                                ],
                            },
                        }
                    );
                    const sentMessageId = sentMessage.message_id;
                    log(`Sent message with icon and button: chatId=${chatId}, messageId=${sentMessageId}, userId=${ctx.from.id}`);

                    setTimeout(async () => {
                        try {
                            await ctx.telegram.deleteMessage(chatId, sentMessageId);
                            log(`Deleted button message: chatId=${chatId}, messageId=${sentMessageId}`);
                        } catch (error) {
                            log(`Error deleting button message: chatId=${chatId}, messageId=${sentMessageId}, error=${error.message}`);
                        }
                    }, 30 * 1000);
                } catch (error) {
                    log(`Error sending image with button: chatId=${chatId}, userId=${ctx.from.id}, error=${error.message}`);
                }
            }

            const linkRegex = /(?:t\.me\/|telegram\.me\/|tg:\/\/)[^\s]+/i;
            if (linkRegex.test(messageText)) {
                const allowedLink = 't.me/Bit_check1_bot';
                if (messageText.includes(allowedLink)) {
                    log(`Allowed link ${allowedLink}: userId=${ctx.from.id}`);
                } else {
                    const isUserAdmin = await isAdmin(ctx);
                    if (!isUserAdmin) {
                        await ctx.telegram.deleteMessage(chatId, messageId).catch((err) => {
                            log(`Error deleting message with link: chatId=${chatId}, messageId=${messageId}, error=${err.message}`);
                        });
                        log(`Deleted message with link: chatId=${chatId}, messageId=${messageId}, userId=${ctx.from.id}`);
                    } else {
                        log(`Link allowed from admin: userId=${ctx.from.id}`);
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
                        await ctx.telegram.deleteMessage(chatId, messageId).catch((err) => {
                            log(`Error deleting message with username: chatId=${chatId}, messageId=${messageId}, error=${err.message}`);
                        });
                        log(`Deleted message with disallowed username: chatId=${chatId}, messageId=${messageId}, userId=${ctx.from.id}, usernames=${usnames.join(',')}`);
                    } else {
                        log(`Username allowed from admin: userId=${ctx.from.id}, usernames=${usernames.join(',')}`);
                    }
                } else {
                    log(`Allowed usernames: userId=${ctx.from.id}, usernames=${usernames.join(',')}`);
                }
            }
        }
    } catch (error) {
        log(`Error processing message: chatId=${ctx.chat.id}, userId=${ctx.from.id}, error=${error.message}`);
    }
});

bot.catch((err, ctx) => {
    log(`Global error for ${ctx.updateType}: ${err.message}`);
});

bot.launch({
    dropPendingUpdates: true,
}).then(() => {
    log('Bot started successfully');
}).catch((err) => {
    log(`Failed to start bot: ${err.message}`);
    setTimeout(() => {
        log('Attempting to reconnect...');
        bot.launch().then(() => log('Bot reconnected successfully'));
    }, 5000);
});

process.once('SIGINT', () => {
    log('Bot stopped (SIGINT)');
    bot.stop('SIGINT');
    logStream.end();
});
process.once('SIGTERM', () => {
    log('Bot stopped (SIGTERM)');
    bot.stop('SIGTERM');
    logStream.end();
});