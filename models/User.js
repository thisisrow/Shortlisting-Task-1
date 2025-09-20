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
    insta_username: { 
        type: String, 
        required: true, 
        unique: false 
    },
    conpany_info:{
        type:String,
        required:false
    },
    ig_user_id: { 
        type: String, 
        default: null 
    },
    access_token: { 
        type: Date, 
        default: null 
    },
    resetToken: { 
        type: String, 
        default: null 
    },
    resetTokenExpiry: { 
        type: Date, 
        default: null 
    },
}, { timestamps: true }); 

module.exports = mongoose.model('User', UserSchema);
