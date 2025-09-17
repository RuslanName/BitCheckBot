const fs = require('fs-extra');
const path = require('path');

function customRandom(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

function selectWinners(users, seed, numWinners) {
    const winners = [];
    const usedIndices = new Set();

    for (let i = 0; i < numWinners && i < users.length; i++) {
        let index;
        do {
            seed = seed * 9301 + 49297;
            index = Math.floor(customRandom(seed) * users.length);
        } while (usedIndices.has(index));

        usedIndices.add(index);
        winners.push(users[index]);
    }

    return winners;
}

function loadJson(name) {
    const filePath = path.join(process.env.DATA_PATH, 'database', `${name}.json`);
    try {
        if (!fs.existsSync(filePath)) {
            return [];
        }
        return fs.readJsonSync(filePath);
    } catch (err) {
        console.error(`Error loading ${name}.json:`, err.message);
        return [];
    }
}

function getEligibleUsers(raffle) {
    const deals = loadJson('deals');
    const users = loadJson('users');
    const startDate = new Date(raffle.startDate);
    const endDate = new Date(raffle.endDate);

    return users.filter(user => {
        const userDeals = deals.filter(d =>
            d.userId === user.id &&
            d.status === 'completed' &&
            new Date(d.timestamp) >= startDate &&
            new Date(d.timestamp) <= endDate
        );

        if (raffle.condition.type === 'dealCount') {
            return userDeals.length >= raffle.condition.value;
        } else if (raffle.condition.type === 'dealSum') {
            const totalSum = userDeals.reduce((sum, d) => sum + (d.rubAmount || 0), 0);
            return totalSum >= raffle.condition.value;
        }
        return false;
    });
}

function generateRaffleResults(raffle) {
    const eligibleUsers = getEligibleUsers(raffle);
    const seed = Date.now() + Math.floor(Math.random() * 1000);
    const numWinners = Math.min(raffle.prizes.length, eligibleUsers.length);
    const winners = selectWinners(eligibleUsers, seed, numWinners);

    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const outputPath = path.join(process.env.DATA_PATH, 'files', 'giveaways', `results_${raffle.id}_${uniqueSuffix}.txt`);
    fs.ensureDirSync(path.dirname(outputPath));

    const conditionText = raffle.condition.type === 'dealCount'
        ? `Количество сделок: ${raffle.condition.value}`
        : `Сумма сделок: ${raffle.condition.value} RUB`;

    const output = `Розыгрыш ID: ${raffle.id}
Период: ${new Date(raffle.startDate).toLocaleString()} - ${new Date(raffle.endDate).toLocaleString()}
Условие: ${conditionText}
Формула: sin(seed) * 10000 - floor(sin(seed) * 10000)
Сид: ${seed}

Участники, выполнившие условия:
${eligibleUsers.length > 0 ? eligibleUsers.map((user, index) => `${index + 1}) @${user.username || 'ID' + user.id}`).join('\n') : 'Нет участников'}

Победители:
${winners.length > 0 ? winners.map((winner, index) => `${index + 1}) @${winner.username || 'ID' + winner.id} - Приз: ${raffle.prizes[index]}`).join('\n') : 'Нет победителей'}`;

    fs.writeFileSync(outputPath, output, 'utf8');
    return { winners, outputPath };
}

module.exports = { generateRaffleResults };