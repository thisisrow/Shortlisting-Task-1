// server.js  (no .env version)
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const http = require('http');

// ---- your modules (leave as-is) ----
const userRoutes = require('./routes/userroutes');
const connectDB = require('./connection/db');

// ================== CONFIG (TEST ONLY – do NOT commit these) ==================
const PORT = 5000;

// From your message:
const ACCESS_TOKEN = "IGAARyPjOfdWNBZAE1qQVZAzWTk1UWFPUkV4MlVkZAWwzcXduZAE81MldaNm9MOU5nQ0hKRFpHUXRvZA1UwN09PVkxJYUV2TEhsdUlXSnRKcnhadHpUenFhYnlhUDJtUmFzV1U5Y3k5YmQ4YS1RTVVEc1B0cHk4cXlNanpOelQxZAkwzQQZDZD";
const IG_USER_ID   = "17841470351044288";

// Set these two from your Meta app for webhook verification/signature
const IG_VERIFY_TOKEN = "kjabkjaBsoiaNIABIXIUABBXAVFGFGWEGFWGFWEGFGDD";  // put the same in the Webhooks dashboard
const APP_SECRET      = "c0f05657a7ed375ed614576e9c467fd8";            // App Dashboard → Basic settings
// ==============================================================================

// Express + HTTP server (for Socket.IO)
const app = express();
const server = http.createServer(app);

// --- Socket.IO (optional; remove if not needed) ---
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: '*' } });

// ---- Core middleware (that won’t break webhook raw body) ----
app.use(cors());
app.use(morgan('dev'));

// ================== WEBHOOK ROUTES (must be before express.json()) ==================
// Meta will hit these endpoints. We must read RAW bytes for signature check.
app.use('/webhooks/instagram', express.raw({ type: '*/*' }));

// GET: webhook verification (handshake)
app.get('/webhooks/instagram', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === IG_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// helper to verify X-Hub-Signature-256
function isValidSignature(req) {
  try {
    const signatureHeader = req.headers['x-hub-signature-256']; // "sha256=..."
    if (!signatureHeader || !APP_SECRET) return false;

    const hmac = crypto.createHmac('sha256', APP_SECRET);
    hmac.update(req.body); // Buffer (raw)
    const expected = `sha256=${hmac.digest('hex')}`;

    // timing-safe compare
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

// POST: webhook receiver
app.post('/webhooks/instagram', async (req, res) => {
  // Always 200 quickly so Meta doesn’t retry
  res.sendStatus(200);

  // If you’re stuck, temporarily skip this check to confirm you’re receiving requests.
  if (!isValidSignature(req)) {
    console.warn('⚠️ Invalid X-Hub-Signature-256');
    return;
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch (e) {
    console.error('Webhook JSON parse error:', e.message);
    return;
  }

  // Expected payload: { object:"instagram", entry:[{ changes:[{ field, value }], ... }] }
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field === 'comments') {
        const { id: commentId, verb } = change.value || {};
        if (!commentId) continue;

        try {
          // Fetch full comment details
          const url = `https://graph.facebook.com/v20.0/${commentId}?fields=id,text,username,timestamp,media&access_token=${ACCESS_TOKEN}`;
          const { data } = await axios.get(url);

          // push to clients (or save to DB)
          io.emit('ig:new_comment', { verb, ...data });
          console.log('💬 IG comment event:', { verb, ...data });
        } catch (e) {
          console.error('Fetch comment failed:', e.response?.data || e.message);
        }
      }
    }
  }
});
// ================== END WEBHOOK ==================

// Now safe to add JSON body parser for your normal routes
app.use(express.json());

// ---- DB + routes (your existing code) ----
connectDB();
app.use('/api/users', userRoutes);

// Health
app.get('/', (req, res) => {
  res.send('hello world');
});

// ================== YOUR EXISTING POLLING ENDPOINT ==================
app.get('/posts', async (req, res) => {
  try {
    const fields = "id,caption,media_type,media_url,permalink,timestamp";
    const url = `https://graph.instagram.com/${IG_USER_ID}/media?fields=${fields}&access_token=${ACCESS_TOKEN}`;
    const response = await axios.get(url);
    const posts = response.data.data || [];

    const postsWithComments = await Promise.all(
      posts.map(async (post) => {
        try {
          const commentsUrl = `https://graph.instagram.com/${post.id}/comments?fields=id,text,username,timestamp&access_token=${ACCESS_TOKEN}`;
          const commentsRes = await axios.get(commentsUrl);
          return { ...post, comments: commentsRes.data.data || [] };
        } catch {
          return { ...post, comments: [] };
        }
      })
    );

    res.json({ success: true, data: postsWithComments });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

// --- Socket.IO logs (optional)
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  socket.on('disconnect', () => console.log('🔌 Client disconnected:', socket.id));
});

// Start
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
