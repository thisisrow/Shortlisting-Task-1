// server.js (minimal version: only posts + users)
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const axios = require('axios');

const userRoutes = require('./routes/userroutes');
const connectDB = require('./connection/db');

// ================== CONFIG (TEST ONLY – do NOT commit these) ==================
const PORT = process.env.PORT || 5000;
const ACCESS_TOKEN = "IGAARyPjOfdWNBZAE1qQVZAzWTk1UWFPUkV4MlVkZAWwzcXduZAE81MldaNm9MOU5nQ0hKRFpHUXRvZA1UwN09PVkxJYUV2TEhsdUlXSnRKcnhadHpUenFhYnlhUDJtUmFzV1U5Y3k5YmQ4YS1RTVVEc1B0cHk4cXlNanpOelQxZAkwzQQZDZD";
const IG_USER_ID   = "17841470351044288";
const IG_USERNAME  = "let.be.crazy";
const IG_VERIFY_TOKEN = "kjabkjaBsoiaNIABIXIUABBXAVFGFGWEGFGDD";
const APP_SECRET      = "c0f05657a7ed375ed614576e9c467fd8";
// ==============================================================================

const app = express();

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// ================== Connect DB ==================
connectDB();

// ================== Routes ==================
app.use('/api/users', userRoutes);
app.get('/', (req, res) => res.send('hello world'));

// ================== REST: posts (get all details) ==================
app.get('/posts', async (req, res) => {
  try {
    const fields = "id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count";
    const url = `https://graph.instagram.com/${IG_USER_ID}/media?fields=${fields}&access_token=${ACCESS_TOKEN}`;
    const { data: list } = await axios.get(url);
    const items = list.data || [];

    const shaped = await Promise.all(items.map(async (p) => {
      let comments = [];
      try {
        const cu = `https://graph.instagram.com/${p.id}/comments?fields=id,text,username,timestamp&access_token=${ACCESS_TOKEN}`;
        const { data: cRes } = await axios.get(cu);
        comments = (cRes.data || []).map(c => ({
          id: c.id,
          text: c.text || '',
          username: c.username || '',
          timestamp: c.timestamp || '',
          isMine: (c.username || '').toLowerCase() === IG_USERNAME.toLowerCase()
        }));
        comments.sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));
      } catch (_) { comments = []; }

      return {
        id: p.id,
        caption: p.caption || '',
        mediaType: p.media_type,
        imageUrl: p.media_url,
        permalink: p.permalink,
        timestamp: p.timestamp,
        likes: p.like_count ?? 0,
        commentsCount: p.comments_count ?? comments.length,
        comments
      };
    }));

    res.json({ success: true, data: shaped });
  } catch (error) {
    res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
});

// ================== Start ==================
app.listen(PORT, () => {
  console.log('Server is running on port', PORT);
});
