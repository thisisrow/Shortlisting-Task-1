const dotenv = require('dotenv');
const express = require('express');
const morgan = require("morgan");
const cors = require('cors'); 
const userRoutes = require('./routes/userroutes');
const connectDB = require('./connection/db');
const  axios = require('axios');

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


// Replace with the user’s long-lived access token (store securely in DB)
const ACCESS_TOKEN = "IGAARyPjOfdWNBZAE1qQVZAzWTk1UWFPUkV4MlVkZAWwzcXduZAE81MldaNm9MOU5nQ0hKRFpHUXRvZA1UwN09PVkxJYUV2TEhsdUlXSnRKcnhadHpUenFhYnlhUDJtUmFzV1U5Y3k5YmQ4YS1RTVVEc1B0cHk4cXlNanpOelQxZAkwzQQZDZD";
const IG_USER_ID = "17841470351044288"; 


// Fetch posts with comments
app.get("/posts", async (req, res) => {
  try {
    const fields = "id,caption,media_type,media_url,permalink,timestamp";
    const url = `https://graph.instagram.com/${IG_USER_ID}/media?fields=${fields}&access_token=${ACCESS_TOKEN}`;
    const response = await axios.get(url);

    const posts = response.data.data;

    // Fetch comments for each post
    const postsWithComments = await Promise.all(
      posts.map(async (post) => {
        try {
          const commentsUrl = `https://graph.instagram.com/${post.id}/comments?fields=id,text,username,timestamp&access_token=${ACCESS_TOKEN}`;
          const commentsRes = await axios.get(commentsUrl);

          return {
            ...post,
            comments: commentsRes.data.data || [],
          };
        } catch {
          return { ...post, comments: [] }; // In case comments are restricted
        }
      })
    );

    res.json({
      success: true,
      data: postsWithComments,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});


// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
