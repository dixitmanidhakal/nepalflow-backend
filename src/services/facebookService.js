/**
 * NepalFlow - Facebook Graph API Service
 * Handles: page posting, Instagram publishing, comment/DM fetching, analytics
 * Graph API v19.0
 */

const axios = require('axios');

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

/**
 * Generic Graph API GET request
 */
async function graphGet(path, params = {}) {
  try {
    const response = await axios.get(`${GRAPH_BASE}/${path}`, { params });
    return response.data;
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message;
    throw new Error(`Facebook API Error: ${msg}`);
  }
}

/**
 * Generic Graph API POST request
 */
async function graphPost(path, data = {}) {
  try {
    const response = await axios.post(`${GRAPH_BASE}/${path}`, data);
    return response.data;
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message;
    throw new Error(`Facebook API Error: ${msg}`);
  }
}

// ─────────────────────────────────────────────
// FACEBOOK PAGE POSTING
// ─────────────────────────────────────────────

/**
 * Publish a text (+ optional image) post to a Facebook Page
 * @returns {string} Platform post ID
 */
async function publishToFacebookPage({ pageId, accessToken, message, mediaUrls = [] }) {
  // Sandbox/mock mode
  if (process.env.NODE_ENV !== 'production' && process.env.FB_SANDBOX === 'true') {
    console.log(`[SANDBOX] Would publish to FB Page ${pageId}: "${message}"`);
    return `mock_fb_post_${Date.now()}`;
  }

  if (mediaUrls.length > 0) {
    // Post with photo
    const data = {
      message,
      url: mediaUrls[0],
      access_token: accessToken,
    };
    const result = await graphPost(`${pageId}/photos`, data);
    return result.post_id || result.id;
  } else {
    // Text-only post
    const data = { message, access_token: accessToken };
    const result = await graphPost(`${pageId}/feed`, data);
    return result.id;
  }
}

// ─────────────────────────────────────────────
// INSTAGRAM PUBLISHING
// ─────────────────────────────────────────────

/**
 * Publish to Instagram Business Account via Graph API
 * Requires: image URL (Instagram requires public URL for media)
 */
async function publishToInstagram({ igAccountId, accessToken, caption, mediaUrls = [] }) {
  if (process.env.NODE_ENV !== 'production' && process.env.FB_SANDBOX === 'true') {
    console.log(`[SANDBOX] Would publish to IG Account ${igAccountId}: "${caption}"`);
    return `mock_ig_post_${Date.now()}`;
  }

  if (mediaUrls.length === 0) {
    throw new Error('Instagram requires at least one media URL');
  }

  // Step 1: Create media container
  const containerRes = await graphPost(`${igAccountId}/media`, {
    image_url: mediaUrls[0],
    caption,
    access_token: accessToken,
  });

  const containerId = containerRes.id;

  // Step 2: Publish the container
  const publishRes = await graphPost(`${igAccountId}/media_publish`, {
    creation_id: containerId,
    access_token: accessToken,
  });

  return publishRes.id;
}

// ─────────────────────────────────────────────
// UNIFIED INBOX - COMMENTS & DMs
// ─────────────────────────────────────────────

/**
 * Fetch recent comments from all posts on a Facebook Page
 */
async function fetchPageComments({ pageId, accessToken, since = null }) {
  const params = {
    access_token: accessToken,
    fields: 'id,message,from,created_time,can_reply_privately',
    limit: 50,
  };
  if (since) params.since = since;

  const result = await graphGet(`${pageId}/feed`, params);
  const comments = [];

  for (const post of (result.data || [])) {
    if (post.comments) {
      for (const comment of post.comments.data || []) {
        comments.push({
          platform_comment_id: comment.id,
          post_platform_id: post.id,
          commenter_name: comment.from?.name || 'Unknown',
          commenter_id: comment.from?.id,
          message: comment.message,
          comment_type: 'comment',
          platform_time: comment.created_time,
        });
      }
    }
  }

  return comments;
}

/**
 * Fetch DMs (Conversations) from a Facebook Page
 */
async function fetchPageDMs({ pageId, accessToken }) {
  const params = {
    access_token: accessToken,
    fields: 'id,participants,messages{message,from,created_time}',
    limit: 25,
  };

  const result = await graphGet(`${pageId}/conversations`, params);
  const dms = [];

  for (const convo of (result.data || [])) {
    const msgs = convo.messages?.data || [];
    const participant = convo.participants?.data?.find(p => p.id !== pageId);

    for (const msg of msgs) {
      if (msg.from?.id !== pageId) {
        dms.push({
          platform_comment_id: `dm_${msg.id}`,
          commenter_name: participant?.name || msg.from?.name || 'Unknown',
          commenter_id: participant?.id || msg.from?.id,
          message: msg.message,
          comment_type: 'dm',
          platform_time: msg.created_time,
        });
      }
    }
  }

  return dms;
}

/**
 * Reply to a comment on Facebook
 */
async function replyToComment({ commentId, message, accessToken }) {
  if (process.env.FB_SANDBOX === 'true') {
    console.log(`[SANDBOX] Would reply to comment ${commentId}: "${message}"`);
    return { success: true, mock: true };
  }

  const result = await graphPost(`${commentId}/comments`, {
    message,
    access_token: accessToken,
  });
  return result;
}

// ─────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────

/**
 * Fetch post-level insights from Facebook
 */
async function fetchPostInsights({ postId, accessToken }) {
  try {
    const result = await graphGet(`${postId}`, {
      access_token: accessToken,
      fields: 'likes.summary(true),comments.summary(true),shares,insights.metric(post_impressions,post_reach)',
    });

    return {
      likes_count: result.likes?.summary?.total_count || 0,
      comments_count: result.comments?.summary?.total_count || 0,
      shares_count: result.shares?.count || 0,
      impressions: result.insights?.data?.find(m => m.name === 'post_impressions')?.values?.[0]?.value || 0,
      reach: result.insights?.data?.find(m => m.name === 'post_reach')?.values?.[0]?.value || 0,
    };
  } catch {
    return { likes_count: 0, comments_count: 0, shares_count: 0, impressions: 0, reach: 0 };
  }
}

/**
 * Get list of FB Pages a user manages (via user token)
 */
async function getUserPages(userAccessToken) {
  const result = await graphGet('me/accounts', {
    access_token: userAccessToken,
    fields: 'id,name,access_token,picture,instagram_business_account',
  });
  return result.data || [];
}

/**
 * Exchange short-lived token for long-lived token
 */
async function getLongLivedToken(shortLivedToken) {
  const result = await graphGet('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: process.env.FACEBOOK_APP_ID,
    client_secret: process.env.FACEBOOK_APP_SECRET,
    fb_exchange_token: shortLivedToken,
  });
  return result.access_token;
}

module.exports = {
  publishToFacebookPage,
  publishToInstagram,
  fetchPageComments,
  fetchPageDMs,
  replyToComment,
  fetchPostInsights,
  getUserPages,
  getLongLivedToken,
};
