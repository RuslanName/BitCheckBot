const path = require('path');
const fs = require('fs-extra');
const { DATA_PATH } = require("../config/constants");

const cache = new Map();
const cacheTimestamps = new Map();
const CACHE_TTL = 5000;

const indexes = {
    usersById: new Map(),
    dealsByUserId: new Map(),
    withdrawalsByUserId: new Map(),
    completedDealsByUserId: new Map()
};

function buildIndexes() {
    indexes.usersById.clear();
    indexes.dealsByUserId.clear();
    indexes.withdrawalsByUserId.clear();
    indexes.completedDealsByUserId.clear();

    const users = getCachedData('users');
    const deals = getCachedData('deals');
    const withdrawals = getCachedData('withdrawals');

    users.forEach(u => {
        indexes.usersById.set(String(u.id), u);
    });

    deals.forEach(d => {
        if (!d || d.status === 'draft') return;
        const userId = String(d.userId);
        if (!indexes.dealsByUserId.has(userId)) {
            indexes.dealsByUserId.set(userId, []);
        }
        indexes.dealsByUserId.get(userId).push(d);
        
        if (d.status === 'completed' && (d.rubAmount || d.amount)) {
            if (!indexes.completedDealsByUserId.has(userId)) {
                indexes.completedDealsByUserId.set(userId, []);
            }
            indexes.completedDealsByUserId.get(userId).push(d);
        }
    });

    withdrawals.forEach(w => {
        if (!w || w.status === 'draft') return;
        const userId = String(w.userId);
        if (!indexes.withdrawalsByUserId.has(userId)) {
            indexes.withdrawalsByUserId.set(userId, []);
        }
        indexes.withdrawalsByUserId.get(userId).push(w);
    });
}

function getCachedData(name) {
    const now = Date.now();
    const cached = cache.get(name);
    const timestamp = cacheTimestamps.get(name);
    
    if (cached !== undefined && timestamp && (now - timestamp) < CACHE_TTL) {
        return cached;
    }
    
    const filePath = path.join(DATA_PATH, 'database', `${name}.json`);
    const isObjectType = ['config', 'states'].includes(name);
    
    try {
        if (!fs.existsSync(filePath)) {
            const empty = isObjectType ? {} : [];
            cache.set(name, empty);
            cacheTimestamps.set(name, now);
            return empty;
        }
        const data = fs.readJsonSync(filePath);
        
        if (data === null || data === undefined) {
            const empty = isObjectType ? {} : [];
            cache.set(name, empty);
            cacheTimestamps.set(name, now);
            return empty;
        }
        
        let processedData;
        if (Array.isArray(data)) {
            processedData = data;
        } else if (typeof data === 'object') {
            const keys = Object.keys(data);
            if (isObjectType) {
                processedData = data;
            } else if (keys.length > 0 && !isNaN(keys[0])) {
                processedData = Object.values(data);
            } else {
                processedData = data;
            }
        } else {
            processedData = data;
        }
        
        if (processedData === null || processedData === undefined) {
            processedData = isObjectType ? {} : [];
        }
        
        cache.set(name, processedData);
        cacheTimestamps.set(name, now);
        
        if (['users', 'deals', 'withdrawals'].includes(name)) {
            buildIndexes();
        }
        
        return processedData;
    } catch (err) {
        console.error(`Error loading ${name}.json:`, err.message);
        const empty = isObjectType ? {} : [];
        cache.set(name, empty);
        cacheTimestamps.set(name, now);
        return empty;
    }
}

function loadJson(name) {
    return getCachedData(name);
}

function saveJson(name, data) {
    try {
        const filePath = path.join(DATA_PATH, 'database', `${name}.json`);
        fs.writeJsonSync(filePath, data, { spaces: 2 });
        
        const isObjectType = ['config', 'states'].includes(name);
        
        let processedData;
        if (data === null || data === undefined) {
            processedData = isObjectType ? {} : [];
        } else if (Array.isArray(data)) {
            processedData = data;
        } else if (typeof data === 'object') {
            if (isObjectType) {
                processedData = data;
            } else {
                const keys = Object.keys(data);
                if (keys.length > 0 && !isNaN(keys[0])) {
                    processedData = Object.values(data);
                } else {
                    processedData = data;
                }
            }
        } else {
            processedData = data;
        }
        
        if (processedData === null || processedData === undefined) {
            processedData = isObjectType ? {} : [];
        }
        
        cache.set(name, processedData);
        cacheTimestamps.set(name, Date.now());
        
        if (['users', 'deals', 'withdrawals'].includes(name)) {
            buildIndexes();
        }
    } catch (err) {
        console.error(`Error saving ${name}.json:`, err.message);
    }
}

function getUserById(userId) {
    return indexes.usersById.get(String(userId)) || null;
}

function getDealsByUserId(userId) {
    return indexes.dealsByUserId.get(String(userId)) || [];
}

function getCompletedDealsByUserId(userId) {
    return indexes.completedDealsByUserId.get(String(userId)) || [];
}

function getWithdrawalsByUserId(userId) {
    return indexes.withdrawalsByUserId.get(String(userId)) || [];
}

function invalidateCache(name) {
    cache.delete(name);
    cacheTimestamps.delete(name);
    if (['users', 'deals', 'withdrawals'].includes(name)) {
        buildIndexes();
    }
}

module.exports = { 
    loadJson, 
    saveJson, 
    getUserById,
    getDealsByUserId,
    getCompletedDealsByUserId,
    getWithdrawalsByUserId,
    invalidateCache
};

