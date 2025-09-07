const mongoose = require('mongoose');

const PostSchema = new mongoose.Schema({
    post_id: { 
        type: String, 
        required: true, 
        unique: true 
    },
    context: { 
        type: String, 
        required: true, 
        unique: true 
    },
}, { timestamps: true }); 

module.exports = mongoose.model('Post', PostSchema);
