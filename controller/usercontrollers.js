const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const axios = require('axios'); // Add axios to the requires
const User = require('../models/User');
const dotenv = require("dotenv");
dotenv.config();

// User Registration
exports.registerUser = async (req, res) => {
    console.log('Registration request received:', req.body);
    
    const { username, email, password } = req.body;
    
    // Input validation
    if (!username || !email || !password) {
        console.log('Missing required fields');
        return res.status(400).json({ 
            success: false,
            error: 'All fields are required',
            required: ['username', 'email', 'password'],
            received: { username: !!username, email: !!email, password: !!password }
        });
    }

    try {
        console.log('Checking for existing user with email:', email, 'or username:', username);
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        
        if (existingUser) {
            if (existingUser.email === email) {
                console.log('Email already in use:', email);
                return res.status(400).json({ 
                    success: false,
                    error: 'Email already in use',
                    field: 'email'
                });
            }
            if (existingUser.username === username) {
                console.log('Username already taken:', username);
                return res.status(400).json({ 
                    success: false,
                    error: 'Username already taken',
                    field: 'username'
                });
            }
        }

        console.log('Hashing password...');
        const hashedPassword = await bcrypt.hash(password, 10);
        
        console.log('Creating new user...');
        const newUser = new User({ 
            username, 
            email: email.toLowerCase(), // Ensure email is lowercase
            password: hashedPassword 
        });
        
        console.log('Saving user to database...');
        await newUser.save();
        
        console.log('User registered successfully:', newUser.email);
        res.status(201).json({ 
            success: true,
            message: 'User registered successfully',
            user: {
                id: newUser._id,
                username: newUser.username,
                email: newUser.email
            }
        });
        
    } catch (error) {
        console.error('Registration error:', {
            name: error.name,
            message: error.message,
            code: error.code,
            keyPattern: error.keyPattern,
            keyValue: error.keyValue,
            errors: error.errors
        });
        
        let errorMessage = 'Error registering user';
        let errorDetails = {};
        
        // Handle specific MongoDB errors
        if (error.name === 'ValidationError') {
            errorMessage = 'Validation error';
            Object.keys(error.errors).forEach(field => {
                errorDetails[field] = error.errors[field].message;
            });
        } else if (error.code === 11000) {
            errorMessage = 'Duplicate key error';
            errorDetails = {
                field: Object.keys(error.keyPattern)[0],
                value: error.keyValue[Object.keys(error.keyPattern)[0]]
            };
        }
        
        res.status(500).json({ 
            success: false,
            error: errorMessage,
            details: errorDetails,
            // Only include stack trace in development
            ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
        });
    }
};

// User Login
exports.loginUser = async (req, res) => {
    console.log('Login attempt:', { username: req.body.username });
    
    const { username, password } = req.body;
    
    // Input validation
    if (!username || !password) {
        console.log('Missing credentials');
        return res.status(400).json({ 
            success: false,
            error: 'Username and password are required',
            received: { username: !!username, password: !!password }
        });
    }

    try {
        console.log('Looking for user:', username);
        const user = await User.findOne({ username }).select('+password');
        
        if (!user) {
            console.log('User not found:', username);
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid credentials' // Generic message for security
            });
        }

        console.log('User found, checking password...');
        const isMatch = await bcrypt.compare(password, user.password);
        
        if (!isMatch) {
            console.log('Invalid password for user:', username);
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid credentials' // Generic message for security
            });
        }

        console.log('Password valid, generating token...');
        const token = jwt.sign(
            { id: user._id },
            process.env.JWT_SECRET || 'your_jwt_secret',
            { expiresIn: '1h' }
        );

        // Get user data without sensitive information
        const userData = user.toObject();
        delete userData.password;
        delete userData.resetToken;
        delete userData.resetTokenExpiry;

        console.log('Login successful for user:', user.username);
        res.status(200).json({
            success: true,
            token,
            user: userData
        });
        
    } catch (error) {
        console.error('Login error:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        
        res.status(500).json({ 
            success: false,
            error: 'Authentication failed',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Store Instagram username for a user
exports.storeInstaUsername = async (req, res) => {
    const { insta_username } = req.body;
    const userId = req.user.id; // Get ID from authenticated user

    if (!insta_username) {
        return res.status(400).json({ error: "Instagram username is required" });
    }

    try {
        const existingUser = await User.findById(userId);
        if (!existingUser) {
            return res.status(404).json({ error: "User not found" });
        }

        existingUser.insta_username = insta_username;
        await existingUser.save();

        res.status(200).json({ 
            message: "Instagram username stored successfully",
            user: {
                id: existingUser._id,
                insta_username: existingUser.insta_username
            }
        });
    } catch (error) {
        console.error("Error storing insta username:", error);
        if (error.name === 'CastError') {
            return res.status(400).json({ error: "Invalid user ID format" });
        }
        res.status(500).json({ error: "Error in storing Instagram username" });
    }
};



// Post Instagram Comment
exports.postComment = async (req, res) => {
    const { mediaId, commentText } = req.body;
    const userId = req.user.id;

    if (!mediaId || !commentText) {
        return res.status(400).json({ error: 'Media ID and comment text are required' });
    }

    if (commentText.length > 300) {
        return res.status(400).json({ error: 'Comment cannot be longer than 300 characters' });
    }

    try {
        // Get the user to verify they have an Instagram username
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (!user.insta_username) {
            return res.status(400).json({ error: 'Instagram username not set for this user' });
        }

        // Instagram Graph API endpoint for posting comments
        // Note: This requires the 'instagram_manage_comments' permission
        const url = `https://graph.instagram.com/${mediaId}/comments`;
        
        const response = await axios.post(url, null, {
            params: {
                message: commentText,
                access_token: "IGAARyPjOfdWNBZAE1qQVZAzWTk1UWFPUkV4MlVkZAWwzcXduZAE81MldaNm9MOU5nQ0hKRFpHUXRvZA1UwN09PVkxJYUV2TEhsdUlXSnRKcnhadHpUenFhYnlhUDJtUmFzV1U5Y3k5YmQ4YS1RTVVEc1B0cHk4cXlNanpOelQxZAkwzQQZDZD"
            }
        });

        // If we reach here, the comment was posted successfully
        res.status(200).json({
            success: true,
            message: 'Comment posted successfully',
            comment: {
                id: response.data.id,
                text: commentText,
                username: user.insta_username,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Error posting comment:', error.response?.data || error.message);
        
        let errorMessage = 'Error posting comment';
        if (error.response?.data?.error) {
            errorMessage = error.response.data.error.message || errorMessage;
        }
        
        res.status(500).json({
            success: false,
            error: errorMessage
        });
    }
};