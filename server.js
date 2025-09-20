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
const PORT = process.env.PORT || 5000;

const ACCESS_TOKEN = "IGAARyPjOfdWNBZAE1qQVZAzWTk1UWFPUkV4MlVkZAWwzcXduZAE81MldaNm9MOU5nQ0hKRFpHUXRvZA1UwN09PVkxJYUV2TEhsdUlXSnRKcnhadHpUenFhYnlhUDJtUmFzV1U5Y3k5YmQ4YS1RTVVEc1B0cHk4cXlNanpOelQxZAkwzQQZDZD";
const IG_USER_ID   = "17841470351044288";
const IG_VERIFY_TOKEN = "kjabkjaBsoiaNIABIXIUABBXAVFGFGWEGFWGFWEGFGDD";   // must match dashboard
const APP_SECRET      = "c0f05657a7ed375ed614576e9c467fd8";               // App Dashboard → app secret
// ==============================================================================

// Express + HTTP server (for Socket.IO)
const app = express();
const server = http.createServer(app);

// --- Socket.IO (optional live updates) ---
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: '*' } });

// ---- Core middleware (safe for webhook GET) ----
app.use(cors());
app.use(morgan('dev'));

// ============== DEBUG: keep last few webhook payloads ==============
const RECENT_EVENTS = [];

// ================== WEBHOOK ROUTES ==================
// GET: verification handshake (no raw body here)
app.get('/webhooks/instagram', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === IG_VERIFY_TOKEN && challenge) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// POST: actual events (use raw for signature verification)
app.post(
  '/webhooks/instagram',
  express.raw({ type: '*/*' }),
  async (req, res) => {
    // ACK quickly so Meta doesn't retry
    res.sendStatus(200);

    // (temporarily comment next 3 lines if you need to debug delivery)
    if (!isValidSignature(req)) {
      console.warn('⚠️ Invalid X-Hub-Signature-256');
      return;
    }

    let payload;
    try { payload = JSON.parse(req.body.toString()); }
    catch (e) { console.error('Webhook JSON parse error:', e.message); return; }

    // keep a copy for /webhooks/_events viewer
    RECENT_EVENTS.unshift({ receivedAt: new Date().toISOString(), payload });
    RECENT_EVENTS.splice(50);

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

            // broadcast to any connected clients
            io.emit('ig:new_comment', { verb, ...data });
            console.log('💬 IG comment event:', { verb, ...data });
          } catch (e) {
            console.error('Fetch comment failed:', e.response?.data || e.message);
          }
        }
      }
    }
  }
);

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
// ================== END WEBHOOK ==================

// After webhook routes, normal JSON parsing is safe
app.use(express.json());

// ---- DB + routes (your existing code) ----
connectDB();
app.use('/api/users', userRoutes);

// Health
app.get('/', (req, res) => res.send('hello world'));

// ===== Debug endpoints (so you can SEE data quickly) =====
app.get('/webhooks/_events', (req, res) => {
  res.json({ count: RECENT_EVENTS.length, items: RECENT_EVENTS });
});

app.get('/debug', (req, res) => {
  res.type('html').send(`
    <!doctype html><meta charset="utf-8">
    <h1>IG Webhook live comments</h1>
    <ul id="list" style="font-family: system-ui, sans-serif"></ul>
    <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
    <script>
      const socket = io(location.origin, { transports: ['websocket'] });
      const ul = document.getElementById('list');
      socket.on('ig:new_comment', c => {
        const li = document.createElement('li');
        li.textContent = '[' + (c.timestamp || new Date().toISOString()) + '] @' + (c.username||'') + ': ' + (c.text||JSON.stringify(c));
        ul.prepend(li);
      });
    </script>
  `);
});

// ================== Your existing polling endpoint ==================
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
  console.log(`Server is running on port ${PORT}`);
});
