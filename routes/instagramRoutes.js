// routes/instagramRoutes.js
const express = require('express');
const axios = require('axios');

const router = express.Router();

const {
  FB_APP_ID,
  FB_APP_SECRET,
  FB_REDIRECT_URI,
  GRAPH_VERSION = 'v19.0',
} = process.env;
console.log('FB_APP_ID:', FB_APP_ID);
const GRAPH = (path) => `https://graph.facebook.com/${GRAPH_VERSION}${path}`;

// ---- Demo token store (replace with DB in production) ----
let TOKENS = {
  userAccessToken: null,
  pageAccessToken: null,
  pageId: null,
  igUserId: null,
};

// 1) Start OAuth: redirect user to Facebook Login (Business)
router.get('/login', (req, res) => {
  const scopes = [
    'pages_show_list',
    'pages_read_engagement',
    'instagram_basic',
    'instagram_manage_comments',
  ].join(',');

  const url =
    `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth` +
    `?client_id=${encodeURIComponent(FB_APP_ID)}` +
    `&redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&response_type=code`;

  res.redirect(url);
});

// 2) OAuth callback -> exchange code for a **User Access Token**
router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code');

  try {
    // Exchange code for short-lived user token
    const tokenResp = await axios.get(
      GRAPH('/oauth/access_token'),
      {
        params: {
          client_id: FB_APP_ID,
          client_secret: FB_APP_SECRET,
          redirect_uri: FB_REDIRECT_URI,
          code,
        },
      }
    );

    const userAccessToken = tokenResp.data.access_token;

    // (Optional) Exchange for a long-lived user token
    const longResp = await axios.get(
      GRAPH('/oauth/access_token'),
      {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: FB_APP_ID,
          client_secret: FB_APP_SECRET,
          fb_exchange_token: userAccessToken,
        },
      }
    );

    TOKENS.userAccessToken = longResp.data.access_token;

    // 3) Get Pages the user manages
    const pagesResp = await axios.get(
      GRAPH('/me/accounts'),
      { params: { access_token: TOKENS.userAccessToken } }
    );

    // Choose a page. In real apps let the user choose; here we pick the first with an IG account.
    let chosenPage = null;
    for (const p of pagesResp.data.data) {
      // look up whether it has an IG account
      const pageDetail = await axios.get(
        GRAPH(`/${p.id}`),
        { params: { fields: 'instagram_business_account', access_token: TOKENS.userAccessToken } }
      );
      if (pageDetail.data.instagram_business_account) {
        chosenPage = { ...p, igBusiness: pageDetail.data.instagram_business_account };
        break;
      }
    }

    if (!chosenPage) {
      return res.status(400).send('No Facebook Page with linked Instagram Business/Creator account found.');
    }

    TOKENS.pageId = chosenPage.id;
    TOKENS.pageAccessToken = chosenPage.access_token;
    TOKENS.igUserId = chosenPage.igBusiness.id;

    res.send({
      message: 'Connected!',
      pageId: TOKENS.pageId,
      igUserId: TOKENS.igUserId,
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send(err.response?.data || 'OAuth error');
  }
});

// 4) Get IG media (posts/reels). Add fields you need.
router.get('/media', async (req, res) => {
  try {
    if (!TOKENS.igUserId || !TOKENS.pageAccessToken) {
      return res.status(400).send('Not connected. Visit /api/instagram/login first.');
    }

    const mediaResp = await axios.get(
      GRAPH(`/${TOKENS.igUserId}/media`),
      {
        params: {
          fields: [
            'id',
            'caption',
            'media_type',
            'media_url',
            'permalink',
            'thumbnail_url',
            'timestamp',
            'like_count',
            'comments_count',
          ].join(','),
          access_token: TOKENS.pageAccessToken,
        },
      }
    );

    res.json(mediaResp.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send(err.response?.data || 'Failed to fetch media');
  }
});

// 5) Get comments for a specific media id
router.get('/media/:mediaId/comments', async (req, res) => {
  const { mediaId } = req.params;
  try {
    if (!TOKENS.pageAccessToken) {
      return res.status(400).send('Not connected. Visit /api/instagram/login first.');
    }

    const commentsResp = await axios.get(
      GRAPH(`/${mediaId}/comments`),
      {
        params: {
          fields: ['id', 'text', 'username', 'timestamp'].join(','),
          // If you need nested replies: 'replies{id,text,username,timestamp}'
          access_token: TOKENS.pageAccessToken,
        },
      }
    );

    res.json(commentsResp.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send(err.response?.data || 'Failed to fetch comments');
  }
});

module.exports = router;
