const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const multer = require('multer');
const { loadJson, saveJson } = require('../utils/storage_utils');
const { authenticateToken, restrictTo } = require('../middleware/auth_middleware');
const { DATA_PATH } = require('../config/constants');

const router = express.Router();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(DATA_PATH, 'images/broadcasts');
        fs.ensureDirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') {
            return cb(new Error('Only PNG, JPG, and JPEG files are allowed'));
        }
        cb(null, true);
    },
    limits: { fileSize: 5 * 1024 * 1024 }
});

router.get('/broadcasts', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    try {
        res.json(loadJson('broadcasts'));
    } catch (err) {
        console.error('Error fetching broadcasts:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.post('/broadcasts', authenticateToken, restrictTo('mainAdmin'), upload.single('image'), (req, res) => {
    try {
        const list = loadJson('broadcasts') || [];
        const item = {
            id: Date.now().toString(),
            text: req.body.content,
            imageName: req.file ? req.file.filename : null,
            scheduledTime: req.body.scheduledTime || null,
            timestamp: new Date().toISOString(),
            isDaily: req.body.isDaily === 'true'
        };
        if (!item.isDaily) {
            item.status = 'pending';
        }
        list.push(item);
        saveJson('broadcasts', list);
        if (req.broadcastEmitter) {
            req.broadcastEmitter.emit('newBroadcast');
        }
        res.status(201).json(item);
    } catch (err) {
        console.error('Error creating broadcast:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.put('/broadcasts/:id', authenticateToken, restrictTo('mainAdmin'), upload.single('image'), (req, res) => {
    try {
        let list = loadJson('broadcasts');
        const idx = list.findIndex(b => b.id === req.params.id);
        if (idx === -1) {
            return res.sendStatus(404);
        }

        const existingBroadcast = list[idx];
        const imagePath = existingBroadcast.imageName ? path.join(DATA_PATH, 'images/broadcasts', existingBroadcast.imageName) : null;
        if (req.file && imagePath && fs.existsSync(imagePath)) {
            fs.removeSync(imagePath);
        }

        list[idx] = {
            ...existingBroadcast,
            text: req.body.content || existingBroadcast.text,
            imageName: req.file ? req.file.filename : existingBroadcast.imageName,
            scheduledTime: req.body.scheduledTime || existingBroadcast.scheduledTime,
            timestamp: new Date().toISOString(),
            isDaily: req.body.isDaily === 'true'
        };

        if (!list[idx].isDaily) {
            list[idx].status = 'pending';
        }

        saveJson('broadcasts', list);
        if (req.broadcastEmitter) {
            req.broadcastEmitter.emit('updateBroadcast');
        }
        res.json(list[idx]);
    } catch (err) {
        console.error('Error updating broadcast:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.delete('/broadcasts/:id', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    try {
        let list = loadJson('broadcasts');
        const broadcast = list.find(x => x.id === req.params.id);
        if (broadcast && broadcast.imageName) {
            const imagePath = path.join(DATA_PATH, 'images/broadcasts', broadcast.imageName);
            fs.removeSync(imagePath);
        }
        list = list.filter(x => x.id !== req.params.id);
        saveJson('broadcasts', list);
        res.sendStatus(204);
    } catch (err) {
        console.error('Error deleting broadcast:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = { router, upload };

