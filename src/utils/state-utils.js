const fs = require('fs');
const path = require('path');
const { DATA_PATH } = require('../config');

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
                pendingOperatorMessages: {},
                pendingCashback: {},
                pendingReferral: {},
                pendingWithdrawBalance: {}
            };
            fs.writeFileSync(filePath, JSON.stringify(defaultStates, null, 2));
            return defaultStates;
        }
        const data = JSON.parse(fs.readFileSync(filePath));
        if (!data.pendingCashback) {
            data.pendingCashback = {};
        }
        if (!data.pendingReferral) {
            data.pendingReferral = {};
        }
        if (!data.pendingWithdrawBalance) {
            data.pendingWithdrawBalance = {};
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return data;
    } catch (err) {
        console.error('Error loading states.json:', err.message);
        return {
            pendingCaptcha: {},
            pendingUpdateProfile: {},
            pendingDeal: {},
            pendingWithdrawal: {},
            pendingTransactionHash: {},
            pendingSupport: {},
            pendingOperatorMessages: {},
            pendingCashback: {},
            pendingReferral: {},
            pendingWithdrawBalance: {}
        };
    }
}

function clearPendingStates(states, userId) {
    delete states.pendingDeal[userId];
    delete states.pendingWithdrawal[userId];
    delete states.pendingUpdateProfile[userId];
    delete states.pendingTransactionHash[userId];
    delete states.pendingSupport[userId];
    delete states.pendingCashback[userId];
    delete states.pendingReferral[userId];
    delete states.pendingWithdrawBalance[userId];
}

module.exports = {
    loadStates,
    clearPendingStates
};

