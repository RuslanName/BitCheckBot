const fs = require('fs');
const path = require('path');
const { DATA_PATH } = require('../config/constants');

function loadStates() {
    const filePath = path.join(DATA_PATH, 'database', 'states.json');
    try {
        if (!fs.existsSync(filePath)) {
            const defaultStates = {
                pendingCaptcha: {},
                pendingUpdateProfile: {},
                pendingDeal: {},
                pendingWithdrawal: {},
                pendingTransactionHash: {},
                pendingSupport: {},
                pendingOperatorMessages: {}
            };
            fs.writeFileSync(filePath, JSON.stringify(defaultStates, null, 2));
            return defaultStates;
        }
        return JSON.parse(fs.readFileSync(filePath));
    } catch (err) {
        console.error('Error loading states.json:', err.message);
        return {
            pendingCaptcha: {},
            pendingUpdateProfile: {},
            pendingDeal: {},
            pendingWithdrawal: {},
            pendingTransactionHash: {},
            pendingSupport: {},
            pendingOperatorMessages: {}
        };
    }
}

function clearPendingStates(states, userId) {
    delete states.pendingDeal[userId];
    delete states.pendingWithdrawal[userId];
    delete states.pendingUpdateProfile[userId];
    delete states.pendingTransactionHash[userId];
    delete states.pendingSupport[userId];
}

module.exports = {
    loadStates,
    clearPendingStates
};

