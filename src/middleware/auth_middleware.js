const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/constants');

function authenticateToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];

    if (!token) {
        if (req.originalUrl === '/') {
            return res.redirect('/login');
        }
        return res.status(401).json({ error: 'Token not provided' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
}

function restrictTo(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        next();
    };
}

module.exports = { authenticateToken, restrictTo };

