const { loadJson } = require('../utils/storage_utils');

async function getCommissionDiscount(userId) {
    try {
        const config = loadJson('config');
        const users = loadJson('users');
        const deals = loadJson('deals');

        let totalDiscount = 0;

        const vipUser = config.vipUsersData?.find(vip => vip.username === users.find(u => u.id === userId)?.username);
        if (vipUser && vipUser.discount) {
            totalDiscount += vipUser.discount;
        }

        const userDeals = deals.filter(d => d.userId === userId && d.status === 'completed');
        const turnover = userDeals.reduce((sum, d) => sum + (d.rubAmount || d.amount || 0), 0);
        const discounts = config.commissionDiscounts || [];
        for (let i = discounts.length - 1; i >= 0; i--) {
            if (turnover >= discounts[i].amount) {
                totalDiscount += discounts[i].discount;
                break;
            }
        }

        return totalDiscount;
    } catch (err) {
        console.error('Error calculating commission discount:', err.message);
        return 0;
    }
}

async function calculateCommission(amount, currency, type) {
    const config = loadJson('config');
    const commissionScale = type === 'buy'
        ? (currency === 'BTC' ? config.buyCommissionScalePercentBTC : config.buyCommissionScalePercentLTC)
        : (currency === 'BTC' ? config.sellCommissionScalePercentBTC : config.sellCommissionScalePercentLTC);

    let commissionPercent = commissionScale[0].commission;
    for (const scale of commissionScale) {
        if (amount >= scale.amount) {
            commissionPercent = scale.commission;
        } else {
            break;
        }
    }

    return (amount * commissionPercent) / 100;
}

module.exports = {
    getCommissionDiscount,
    calculateCommission
};

