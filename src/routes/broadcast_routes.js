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
            return cb(new Error('Разрешены только файлы PNG, JPG и JPEG'));
        }
        cb(null, true);
    },
    limits: { fileSize: 5 * 1024 * 1024 }
});

router.get('/broadcasts', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    try {
        let data = loadJson('broadcasts') || [];
        if (!Array.isArray(data)) {
            data = Object.values(data);
        }

        const { search, page = 1, perPage = 50 } = req.query;
        const term = search ? search.trim().toLowerCase() : '';
        const pageNum = parseInt(page, 10) || 1;
        const perPageNum = parseInt(perPage, 10) || 50;

        let filtered = data.filter(b => {
            if (!b || b.status === 'sent' && !b.isDaily) return false;
            if (term && !b.id.toString().toLowerCase().includes(term) && !(b.text && b.text.toLowerCase().includes(term))) {
                return false;
            }
            return true;
        });

        filtered.sort((a, b) => {
            const timeA = new Date(a.timestamp || 0).getTime();
            const timeB = new Date(b.timestamp || 0).getTime();
            return timeB - timeA;
        });

        const total = filtered.length;
        const totalPages = Math.ceil(total / perPageNum);
        const startIndex = (pageNum - 1) * perPageNum;
        const endIndex = startIndex + perPageNum;
        const paginatedData = filtered.slice(startIndex, endIndex);

        res.json({
            data: paginatedData,
            pagination: {
                page: pageNum,
                perPage: perPageNum,
                total,
                totalPages
            }
        });
    } catch (err) {
        console.error('Error fetching broadcasts:', err.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
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
            isDaily: req.body.isDaily === 'true',
            status: 'pending'
        };
        list.push(item);
        saveJson('broadcasts', list);
        if (req.broadcastEmitter) {
            req.broadcastEmitter.emit('newBroadcast');
        }
        res.status(201).json(item);
    } catch (err) {
        console.error('Error creating broadcast:', err.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
}, (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'Размер файла превышает 5 МБ' });
        }
        return res.status(400).json({ error: `Ошибка загрузки файла: ${err.message}` });
    }
    if (err) {
        return res.status(400).json({ error: err.message || 'Ошибка загрузки файла' });
    }
    next();
});

router.put('/broadcasts/:id', authenticateToken, restrictTo('mainAdmin'), upload.single('image'), (req, res) => {
    try {
        let list = loadJson('broadcasts') || [];
        const idx = list.findIndex(b => b.id === req.params.id);
        if (idx === -1) {
            return res.sendStatus(404);
        }

        const existingBroadcast = list[idx];
        const imagePath = existingBroadcast.imageName ? path.join(DATA_PATH, 'images/broadcasts', existingBroadcast.imageName) : null;
        if (req.file && imagePath && fs.existsSync(imagePath)) {
            try {
                fs.removeSync(imagePath);
            } catch (removeErr) {
                console.error('Error removing old image:', removeErr.message);
            }
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
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
}, (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'Размер файла превышает 5 МБ' });
        }
        return res.status(400).json({ error: `Ошибка загрузки файла: ${err.message}` });
    }
    if (err) {
        return res.status(400).json({ error: err.message || 'Ошибка загрузки файла' });
    }
    next();
});

router.delete('/broadcasts/:id', authenticateToken, restrictTo('mainAdmin'), (req, res) => {
    try {
        let list = loadJson('broadcasts') || [];
        const broadcast = list.find(x => x.id === req.params.id);
        if (broadcast && broadcast.imageName) {
            const imagePath = path.join(DATA_PATH, 'images/broadcasts', broadcast.imageName);
            if (fs.existsSync(imagePath)) {
                try {
                    fs.removeSync(imagePath);
                } catch (removeErr) {
                    console.error('Error removing image:', removeErr.message);
                }
            }
        }
        list = list.filter(x => x.id !== req.params.id);
        saveJson('broadcasts', list);
        res.sendStatus(204);
    } catch (err) {
        console.error('Error deleting broadcast:', err.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

module.exports = { router, upload };

