// server.js  (no .env version)
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const http = require('http');

const userRoutes = require('./routes/userroutes');
const connectDB = require('./connection/db');

const PORT = process.env.PORT || 5000;

const ACCESS_TOKEN = "IGAARyPjOfdWNBZAE1qQVZAzWTk1UWFPUkV4MlVkZAWwzcXduZAE81MldaNm9MOU5nQ0hKRFpHUXRvZA1UwN09PVkxJYUV2TEhsdUlXSnRKcnhadHpUenFhYnlhUDJtUmFzV1U5Y3k5YmQ4YS1RTVVEc1B0cHk4cXlNanpOelQxZAkwzQQZDZD";
const IG_USER_ID   = "17841470351044288";
const IG_USERNAME  = "let.be.crazy"; // <-- set your IG username here
const IG_VERIFY_TOKEN = "kjabkjaBsoiaNIABIXIUABBXAVFGFGWEGFWGFWEGFGDD";
const APP_SECRET      = "c0f05657a7ed375ed614576e9c467fd8";

const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(morgan('dev'));

// In-memory cache/index so we can update posts when webhooks arrive
const RECENT_EVENTS = [];
const POST_INDEX = new Map(); // postId -> post object shaped for frontend

// ===== Webhooks =====
app.get('/webhooks/instagram', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === IG_VERIFY_TOKEN && challenge) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post('/webhooks/instagram', express.raw({ type: '*/*' }), async (req, res) => {
  res.sendStatus(200);

  // TEMP for debugging: comment next 3 lines if you need to confirm delivery
  if (!isValidSignature(req)) {
    console.warn('⚠️ Invalid X-Hub-Signature-256'); return;
  }

  let payload;
  try { payload = JSON.parse(req.body.toString()); }
  catch (e) { console.error('Webhook JSON parse error:', e.message); return; }

  RECENT_EVENTS.unshift({ receivedAt: new Date().toISOString(), payload });
  RECENT_EVENTS.splice(50);

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field === 'comments') {
        const { id: commentId, verb, media_id } = change.value || {};
        if (!commentId) continue;
        try {
          // Fetch full comment + the media it belongs to
          const url = `https://graph.facebook.com/v20.0/${commentId}?fields=id,text,username,timestamp,media&access_token=${ACCESS_TOKEN}`;
          const { data: c } = await axios.get(url);

          // Merge into our index if we already have the post
          const postId = (c.media && c.media.id) || media_id;
          if (postId && POST_INDEX.has(postId)) {
            const post = POST_INDEX.get(postId);
            const newComment = {
              id: c.id,
              text: c.text || '',
              username: c.username || '',
              timestamp: c.timestamp || new Date().toISOString(),
              isMine: (c.username || '').toLowerCase() === IG_USERNAME.toLowerCase()
            };
            post.comments.unshift(newComment);
            post.commentsCount = (post.commentsCount || 0) + (verb === 'remove' ? 0 : 1);
            POST_INDEX.set(postId, post);
            io.emit('ig:new_comment', { postId, comment: newComment, verb: verb || 'add' });
          } else {
            // If we don't have the post cached yet, just broadcast the bare comment
            io.emit('ig:new_comment', { postId, comment: { id: c.id, text: c.text, username: c.username, timestamp: c.timestamp }, verb: verb || 'add' });
          }

          console.log('💬 IG comment event:', { postId, id: c.id, text: c.text, by: c.username, verb: verb || 'add' });
        } catch (e) {
          console.error('Fetch comment failed:', e.response?.data || e.message);
        }
      }
    }
  }
});

function isValidSignature(req) {
  try {
    const signatureHeader = req.headers['x-hub-signature-256'];
    if (!signatureHeader || !APP_SECRET) return false;
    const hmac = crypto.createHmac('sha256', APP_SECRET);
    hmac.update(req.body);
    const expected = `sha256=${hmac.digest('hex')}`;
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch { return false; }
}

// After webhook routes
app.use(express.json());

connectDB();
app.use('/api/users', userRoutes);

app.get('/', (req, res) => res.send('hello world'));

// Inspect raw webhook payloads
app.get('/webhooks/_events', (req, res) => res.json({ count: RECENT_EVENTS.length, items: RECENT_EVENTS }));

// === REST: posts (enriched) ===
app.get('/posts', async (req, res) => {
  try {
    const fields = "id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count";
    const url = `https://graph.instagram.com/${IG_USER_ID}/media?fields=${fields}&access_token=${ACCESS_TOKEN}`;
    const { data: list } = await axios.get(url);
    const posts = list.data || [];

    const postsWithComments = await Promise.all(
      posts.map(async (p) => {
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
          })).sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));
        } catch (_) { comments = []; }

        const shaped = {
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

        // update index for live merging
        POST_INDEX.set(p.id, shaped);
        return shaped;
      })
    );

    res.json({ success: true, data: postsWithComments });
  } catch (error) {
    res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
});

// A frontend-friendly flat list (same as we cache)
app.get('/posts/flat', (req, res) => {
  res.json({ success: true, data: Array.from(POST_INDEX.values()) });
});

// Live viewer
app.get('/debug', (req, res) => {
  res.type('html').send(`
    <!doctype html><meta charset="utf-8">
    <h1>IG Webhook live comments</h1>
    <ul id="list" style="font-family: system-ui, sans-serif"></ul>
    <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
    <script>
      const socket = io(location.origin, { transports: ['websocket'] });
      const ul = document.getElementById('list');
      socket.on('ig:new_comment', e => {
        const li = document.createElement('li');
        const c = e.comment || {};
        li.textContent = 'post ' + (e.postId||'?') + ' — @' + (c.username||'') + ': ' + (c.text||'') + ' (' + (e.verb||'add') + ')';
        ul.prepend(li);
      });
    </script>
  `);
});

io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  socket.on('disconnect', () => console.log('🔌 Client disconnected:', socket.id));
});

server.listen(PORT, () => {
  console.log('Server is running on port', PORT);
});
