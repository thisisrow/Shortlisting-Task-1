const express = require('express');
const axios = require('axios');

const router = express.Router();

const {
  FB_APP_ID,
  FB_APP_SECRET,
  FB_REDIRECT_URI,
  GRAPH_VERSION = 'v19.0',
} = process.env;

const GRAPH = (path) => `https://graph.facebook.com/${GRAPH_VERSION}${path}`;

// Simple in-memory token store — replace with DB in production
let TOKENS = {
  userAccessToken: null,  // long-lived user token
  igUserId: null,         // Instagram professional account id
  username: null,         // Instagram username
};

/**
 * 1) Start OAuth with Instagram Login (new scopes)
 * Doc: Instagram API with Instagram Login
 */
router.get('/login', (_req, res) => {
  const scopes = [
    'instagram_business_basic',
    'instagram_business_manage_comments',
    // add only if you need them:
    // 'instagram_business_content_publish',
    // 'instagram_business_manage_messages',
  ].join(',');

  const url =
    `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth` +
    `?client_id=${encodeURIComponent(FB_APP_ID)}` +
    `&redirect_uri=${encodeURIComponent(FB_REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&response_type=code`;

  res.redirect(url);
});

/**
 * 2) OAuth callback → exchange code for user token,
 *    upgrade to long-lived, then get IG user id from /me
 * Docs: Access tokens (long-lived) + Instagram Login get-started (/me fields)
 */
router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code');

  try {
    // Short-lived user token
    const tokenResp = await axios.get(GRAPH('/oauth/access_token'), {
      params: {
        client_id: FB_APP_ID,
        client_secret: FB_APP_SECRET,
        redirect_uri: FB_REDIRECT_URI,
        code,
      },
    });
    const shortLived = tokenResp.data.access_token;

    // Exchange for long-lived user token (~60d)
    const longResp = await axios.get(GRAPH('/oauth/access_token'), {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: FB_APP_ID,
        client_secret: FB_APP_SECRET,
        fb_exchange_token: shortLived,
      },
    });

    TOKENS.userAccessToken = longResp.data.access_token;

    // Get IG professional account id + username directly from /me
    const meResp = await axios.get(GRAPH('/me'), {
      params: {
        fields: 'instagram_user_id,username',
        access_token: TOKENS.userAccessToken,
      },
    });

    TOKENS.igUserId = meResp.data.instagram_user_id;
    TOKENS.username = meResp.data.username;

    if (!TOKENS.igUserId) {
      return res
        .status(400)
        .send('No Instagram professional account found for this user.');
    }

    res.json({
      message: 'Connected with Instagram Login',
      igUserId: TOKENS.igUserId,
      username: TOKENS.username,
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send(err.response?.data || 'OAuth error');
  }
});

/**
 * 3) Get IG media (posts/reels)
 * Doc: /{ig-user-id}/media
 */
router.get('/media', async (_req, res) => {
  try {
    if (!TOKENS.igUserId || !TOKENS.userAccessToken) {
      return res.status(400).send('Not connected. Visit /api/instagram/login first.');
    }

    const mediaResp = await axios.get(GRAPH(`/${TOKENS.igUserId}/media`), {
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
        access_token: TOKENS.userAccessToken,
      },
    });

    res.json(mediaResp.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send(err.response?.data || 'Failed to fetch media');
  }
});

/**
 * 4) Get comments for a media id
 * Doc: /{ig-media-id}/comments
 */
router.get('/media/:mediaId/comments', async (req, res) => {
  const { mediaId } = req.params;
  try {
    if (!TOKENS.userAccessToken) {
      return res.status(400).send('Not connected. Visit /api/instagram/login first.');
    }

    const commentsResp = await axios.get(GRAPH(`/${mediaId}/comments`), {
      params: {
        fields: 'id,text,username,timestamp',
        // to include replies: 'replies{id,text,username,timestamp}'
        access_token: TOKENS.userAccessToken,
      },
    });

    res.json(commentsResp.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send(err.response?.data || 'Failed to fetch comments');
  }
});

module.exports = router;
