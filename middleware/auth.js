const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
    try {
        // Get token from header
        const token = req.header('Authorization')?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ error: 'No token, authorization denied' });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
        
        // Get user from the token
        const user = await User.findById(decoded.id).select('-password');
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Add user from payload
        req.user = user;
        next();
    } catch (error) {
        console.error('Auth error:', error);
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Token is not valid' });
        } else if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token has expired' });
        }
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = auth;