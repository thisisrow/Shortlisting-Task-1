const dotenv = require('dotenv');
const express = require('express');
const morgan = require("morgan");
const cors = require('cors'); 
const userRoutes = require('./routes/userroutes');
const connectDB = require('./connection/db');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors()); 
app.use(express.json());

// Connect to Database
connectDB();
app.use(morgan("dev"));

// Routes
app.use('/api/users', userRoutes);
app.get('/', (req, res) => {
    res.send("hello world");
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
