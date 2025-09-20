// server.js  (no .env version) — live updates for comments, likes, and new posts
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

// NOTE: Your current token (starts with IGA...) is a Basic Display token.
// It will NOT work for Graph enrichment calls. This code emits from raw webhook,
// and uses polling endpoints that do work with Basic Display. For replying, switch to Graph token.
const ACCESS_TOKEN = "IGAARyPjOfdWNBZAE1qQVZAzWTk1UWFPUkV4MlVkZAWwzcXduZAE81MldaNm9MOU5nQ0hKRFpHUXRvZA1UwN09PVkxJYUV2TEhsdUlXSnRKcnhadHpUenFhYnlhUDJtUmFzV1U5Y3k5YmQ4YS1RTVVEc1B0cHk4cXlNanpOelQxZAkwzQQZDZD";
const IG_USER_ID   = "17841470351044288";
const IG_USERNAME  = "let.be.crazy";
const IG_VERIFY_TOKEN = "kjabkjaBsoiaNIABIXIUABBXAVFGFGWEGFWGFWEGFGDD";
const APP_SECRET      = "c0f05657a7ed375ed614576e9c467fd8";
// ==============================================================================

const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
// allow websocket AND polling (some hosts/proxies need fallback)
const io = new Server(server, { cors: { origin: '*'}, transports: ['websocket','polling'] });

app.use(cors());
app.use(morgan('dev'));

// ============== In-memory cache so we can broadcast diffs ==============
const RECENT_EVENTS = [];               // for debugging
const POST_INDEX = new Map();           // postId -> shaped post for UI

// ================== WEBHOOKS (comments push) ==================
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
  // ACK quick so Meta doesn't retry
  res.sendStatus(200);

  // If debugging delivery, temporarily comment the next 3 lines:
  if (!isValidSignature(req)) {
    console.warn('⚠️ Invalid X-Hub-Signature-256'); return;
  }

  let payload;
  try { payload = JSON.parse(req.body.toString()); }
  catch (e) { console.error('Webhook JSON parse error:', e.message); return; }

  RECENT_EVENTS.unshift({ receivedAt: new Date().toISOString(), payload });
  RECENT_EVENTS.splice(50);

  for (const entry of payload.entry ?? []) {
    const whenIso = entry.time ? new Date(entry.time * 1000).toISOString() : new Date().toISOString();

    for (const change of entry.changes ?? []) {
      if (change.field !== 'comments') continue;

      const v = change.value || {};
      const commentId = v.id;
      const postId    = (v.media && v.media.id) || v.media_id;
      const username  = v.from?.username || '';
      const text      = v.text || '';
      const verb      = v.verb || 'add';

      if (!commentId || !postId) continue;

      const newComment = {
        id: commentId,
        text,
        username,
        timestamp: whenIso,
        isMine: username.toLowerCase() === IG_USERNAME.toLowerCase(),
      };

      // Merge into cache if we have the post already
      if (POST_INDEX.has(postId)) {
        const post = POST_INDEX.get(postId);
        if (verb === 'remove') {
          post.comments = (post.comments || []).filter(c => c.id !== commentId);
          post.commentsCount = Math.max(0, (post.commentsCount || 1) - 1);
        } else {
          const exists = post.comments?.some(c => c.id === commentId);
          if (!exists) {
            post.comments = [newComment, ...(post.comments || [])];
            post.commentsCount = (post.commentsCount || 0) + 1;
          }
        }
        POST_INDEX.set(postId, post);
      }

      // Emit immediately → UI updates without refresh
      io.emit('ig:new_comment', { postId, comment: newComment, verb });
      console.log('💬 ig:new_comment', { postId, by: username, text: text.slice(0,80) });
    }
  }
});

function isValidSignature(req) {
  try {
    const signatureHeader = req.headers['x-hub-signature-256']; // "sha256=..."
    if (!signatureHeader || !APP_SECRET) return false;
    const hmac = crypto.createHmac('sha256', APP_SECRET);
    hmac.update(req.body);
    const expected = `sha256=${hmac.digest('hex')}`;
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch { return false; }
}

// ================== JSON parsing AFTER webhook raw ==================
app.use(express.json());

// ================== Your existing app ==================
connectDB();
app.use('/api/users', userRoutes);
app.get('/', (req, res) => res.send('hello world'));

// Inspect raw webhook payloads
app.get('/webhooks/_events', (req, res) => res.json({ count: RECENT_EVENTS.length, items: RECENT_EVENTS }));

// ================== REST: posts (initial load) ==================
app.get('/posts', async (req, res) => {
  try {
    const posts = await fetchLatestMedia();
    res.json({ success: true, data: posts });
  } catch (error) {
    res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
});

// convenient view of our cache
app.get('/posts/flat', (req, res) => {
  res.json({ success: true, data: Array.from(POST_INDEX.values()) });
});

// ================== Socket.IO logs ==================
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  socket.on('disconnect', () => console.log('🔌 Client disconnected:', socket.id));
});

// ================== Pollers: new posts + likes/comments_count ==================

// pull latest media list; shape and cache it
async function fetchLatestMedia() {
  // Ask for counts too; Basic Display often returns them for Business/Creator
  const fields = "id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count";
  const url = `https://graph.instagram.com/${IG_USER_ID}/media?fields=${fields}&access_token=${ACCESS_TOKEN}`;
  const { data: list } = await axios.get(url);
  const items = list.data || [];

  const shaped = await Promise.all(items.map(async (p) => {
    // Try to fetch comments briefly (may be limited on Basic Display)
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
      // newest first
      comments.sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));
    } catch (_) { comments = []; }

    const post = {
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

    return post;
  }));

  // Diff against POST_INDEX: emit ig:media_new / ig:media_removed and engagement updates
  const previousIds = new Set(POST_INDEX.keys());
  const currentIds = new Set(shaped.map(p => p.id));

  // new posts
  for (const p of shaped) {
    if (!POST_INDEX.has(p.id)) {
      io.emit('ig:media_new', { post: p });
      console.log('🆕 ig:media_new', p.id);
    } else {
      // update engagement deltas
      const old = POST_INDEX.get(p.id);
      if (old.likes !== p.likes || old.commentsCount !== p.commentsCount) {
        io.emit('ig:engagement_update', { postId: p.id, likes: p.likes, commentsCount: p.commentsCount });
        // console.log('🔄 ig:engagement_update', p.id, 'likes', p.likes, 'comments', p.commentsCount);
      }
      // if media_url/caption changed, you can also compare & emit here
    }
    POST_INDEX.set(p.id, p);
  }

  // removed posts
  for (const id of previousIds) {
    if (!currentIds.has(id)) {
      POST_INDEX.delete(id);
      io.emit('ig:media_removed', { postId: id });
      console.log('🗑️ ig:media_removed', id);
    }
  }

  return Array.from(POST_INDEX.values());
}

// Pollers
async function refreshMediaList() {
  try { await fetchLatestMedia(); } catch (e) { /* ignore */ }
}
async function refreshEngagementCounts() {
  // We just reuse fetchLatestMedia (it updates counts + emits if changed)
  await refreshMediaList();
}

// New posts: every 120s (lower it if you want faster)
setInterval(refreshMediaList, 120_000);
// Likes/comments_count: every 90s
setInterval(refreshEngagementCounts, 90_000);

// Prime cache on boot
refreshMediaList().catch(()=>{});

// ================== Start ==================
server.listen(PORT, () => {
  console.log('Server is running on port', PORT);
  
});
