const path = require('path');
const fs = require('fs-extra');
const { DATA_PATH } = require("./constants");

function loadJson(name) {
    const filePath = path.join(DATA_PATH, 'database', `${name}.json`);
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

function saveJson(name, data) {
    try {
        const filePath = path.join(DATA_PATH, 'database', `${name}.json`);
        fs.writeJsonSync(filePath, data, { spaces: 2 });
    } catch (err) {
        console.error(`Error saving ${name}.json:`, err.message);
    }
}

module.exports = { loadJson, saveJson };