const { loadJson, saveJson } = require('./storage-utils');
const { formatDate } = require('./date-utils');
const { loadStates, clearPendingStates } = require('./state-utils');
const { sendBitCheckPhoto, sendReviewPhoto, setMainBotInstance } = require('./telegram-utils');
const { generateCaptcha } = require('./captcha-utils');
const { axiosWithRetry, telegramWithRetry } = require('./retry-utils');

function shouldLogSendError(error) {
    if (!error || !error.message) return true;
    
    const errorMessage = error.message.toLowerCase();
    if (errorMessage.includes('403') && 
        (errorMessage.includes('user is deactivated') || 
         errorMessage.includes('bot was blocked by the user'))) {
        return false;
    }
    
    return true;
}

module.exports = {
    loadJson,
    saveJson,
    formatDate,
    loadStates,
    clearPendingStates,
    sendBitCheckPhoto,
    sendReviewPhoto,
    setMainBotInstance,
    generateCaptcha,
    shouldLogSendError,
    axiosWithRetry,
    telegramWithRetry
};

