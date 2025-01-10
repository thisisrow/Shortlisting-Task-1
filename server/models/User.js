const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: { 
        type: String, 
        required: true, 
        unique: true 
    },
    email: { 
        type: String, 
        required: true, 
        unique: true 
    },
    password: { 
        type: String, 
        required: true 
    },
    resetToken: { 
        type: String, 
        default: null // Token for password reset
    },
    resetTokenExpiry: { 
        type: Date, 
        default: null // Expiry for the reset token
    },
}, { timestamps: true }); // Automatically adds `createdAt` and `updatedAt` fields

module.exports = mongoose.model('User', UserSchema);
