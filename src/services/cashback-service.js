const { loadJson, saveJson } = require('../utils/storage-utils');

async function calculateCashback(commission) {
    try {
        const config = loadJson('config');
        console.log('calculateCashback config:', config);
        const cashbackPercent = config?.cashbackPercent || 3;
        console.log('cashbackPercent:', cashbackPercent, 'commission:', commission);
        const result = Math.round((commission * cashbackPercent) / 100);
        console.log('calculated cashback:', result);
        return result;
    } catch (err) {
        console.error('Error calculating cashback:', err.message);
        return 0;
    }
}

async function addCashback(userId, amount, dealId) {
    try {
        const users = loadJson('users');
        const cashback = await calculateCashback(amount);
        
        if (cashback <= 0) {
            console.log(`[CASHBACK] skipped: amount=${amount}, dealId=${dealId}, reason=zero_amount`);
            return;
        }

        let user = users.find(u => u.id === userId);
        if (!user) {
            console.log(`[CASHBACK] skipped: userId=${userId}, dealId=${dealId}, reason=no_user`);
            return;
        }

        if (!user.cashbackHistory) {
            user.cashbackHistory = [];
        }

        const alreadyApplied = user.cashbackHistory.some(h => h.dealId === dealId);
        if (alreadyApplied) {
            console.log(`[CASHBACK] skipped: dealId=${dealId}, reason=already_applied`);
            return;
        }

        if (!user.cashback) {
            user.cashback = 0;
        }

        user.cashback += cashback;
        user.cashbackHistory.push({
            amount: cashback,
            dealId: dealId,
            timestamp: new Date().toISOString()
        });

        saveJson('users', users);
        console.log(`[CASHBACK] applied: userId=${userId}, dealId=${dealId}, amount=${cashback} RUB`);
    } catch (err) {
        console.error('[CASHBACK] error:', err.message);
    }
}

async function getCashbackWithdrawalFee(amount) {
    return 0;
}

async function canWithdrawCashback(userId, amount) {
    try {
        const users = loadJson('users');
        const config = loadJson('config');
        
        const user = users.find(u => u.id === userId);
        if (!user || !user.cashback) return false;

        const minWithdrawAmount = config.minCashbackWithdrawAmount || 1500;
        return user.cashback >= amount && amount >= minWithdrawAmount;
    } catch (err) {
        console.error('Error checking cashback withdrawal:', err.message);
        return false;
    }
}

async function createCashbackWithdrawal(userId, amount, wallet) {
    try {
        if (!await canWithdrawCashback(userId, amount)) {
            throw new Error('Cannot withdraw cashback');
        }

        const users = loadJson('users');
        const withdrawals = loadJson('cashback-withdrawals');
        
        const user = users.find(u => u.id === userId);
        if (!user || user.cashback < amount) {
            throw new Error('Insufficient cashback balance');
        }

        const fee = 0;
        const finalAmount = amount;

        user.cashback -= amount;

        const withdrawal = {
            id: Date.now().toString(),
            userId: userId,
            username: user.username,
            amount: amount,
            fee: fee,
            finalAmount: finalAmount,
            walletAddress: wallet,
            type: 'cashback',
            status: 'pending',
            timestamp: new Date().toISOString()
        };

        withdrawals.push(withdrawal);

        saveJson('users', users);
        saveJson('cashback-withdrawals', withdrawals);

        return withdrawal;
    } catch (err) {
        console.error('Error creating cashback withdrawal:', err.message);
        throw err;
    }
}

module.exports = {
    calculateCashback,
    addCashback,
    getCashbackWithdrawalFee,
    canWithdrawCashback,
    createCashbackWithdrawal
};