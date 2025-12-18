const { loadJson, saveJson } = require('./storage_utils');
const { formatDate } = require('./date_utils');
const { loadStates, clearPendingStates } = require('./state_utils');
const { sendBitCheckPhoto, setMainBotInstance } = require('./telegram_utils');
const { generateCaptcha } = require('./captcha_utils');

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
    setMainBotInstance,
    generateCaptcha,
    shouldLogSendError
};

