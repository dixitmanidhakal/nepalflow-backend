/**
 * NepalFlow - Facebook Graph API Service
 * Handles: page posting, Instagram publishing, comment/DM fetching, analytics
 * Graph API v19.0
 */

import axios from 'axios';

const GRAPH_BASE = 'https://graph.facebook.com/v19.0';

export interface FacebookComment {
  platform_comment_id: string;
  post_platform_id: string;
  commenter_name: string;
  commenter_id: string | undefined;
  message: string;
  comment_type: string;
  platform_time: string;
}

export interface FacebookDM {
  platform_comment_id: string;
  commenter_name: string;
  commenter_id: string | undefined;
  message: string;
  comment_type: string;
  platform_time: string;
}

export interface PostInsights {
  likes_count: number;
  comments_count: number;
  shares_count: number;
  impressions: number;
  reach: number;
}

/**
 * Generic Graph API GET request
 */
async function graphGet(path: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  try {
    const response = await axios.get(`${GRAPH_BASE}/${path}`, { params });
    return response.data;
  } catch (error: unknown) {
    const err = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
    const msg = err.response?.data?.error?.message || err.message;
    throw new Error(`Facebook API Error: ${msg}`);
  }
}

/**
 * Generic Graph API POST request
 */
async function graphPost(path: string, data: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  try {
    const response = await axios.post(`${GRAPH_BASE}/${path}`, data);
    return response.data;
  } catch (error: unknown) {
    const err = error as { response?: { data?: { error?: { message?: string } } }; message?: string };
    const msg = err.response?.data?.error?.message || err.message;
    throw new Error(`Facebook API Error: ${msg}`);
  }
}

// ─────────────────────────────────────────────
// FACEBOOK PAGE POSTING
// ─────────────────────────────────────────────

/**
 * Publish a text (+ optional image) post to a Facebook Page
 * @returns Platform post ID
 */
export async function publishToFacebookPage({
  pageId,
  accessToken,
  message,
  mediaUrls = [],
}: {
  pageId: string;
  accessToken: string;
  message: string;
  mediaUrls?: string[];
}): Promise<string> {
  // Sandbox/mock mode
  if (process.env.NODE_ENV !== 'production' && process.env.FB_SANDBOX === 'true') {
    console.log(`[SANDBOX] Would publish to FB Page ${pageId}: "${message}"`);
    return `mock_fb_post_${Date.now()}`;
  }

  if (mediaUrls.length > 0) {
    const data = { message, url: mediaUrls[0], access_token: accessToken };
    const result = await graphPost(`${pageId}/photos`, data);
    return (result.post_id || result.id) as string;
  } else {
    const data = { message, access_token: accessToken };
    const result = await graphPost(`${pageId}/feed`, data);
    return result.id as string;
  }
}

// ─────────────────────────────────────────────
// INSTAGRAM PUBLISHING
// ─────────────────────────────────────────────

/**
 * Publish to Instagram Business Account via Graph API
 */
export async function publishToInstagram({
  igAccountId,
  accessToken,
  caption,
  mediaUrls = [],
}: {
  igAccountId: string;
  accessToken: string;
  caption: string;
  mediaUrls?: string[];
}): Promise<string> {
  if (process.env.NODE_ENV !== 'production' && process.env.FB_SANDBOX === 'true') {
    console.log(`[SANDBOX] Would publish to IG Account ${igAccountId}: "${caption}"`);
    return `mock_ig_post_${Date.now()}`;
  }

  if (mediaUrls.length === 0) {
    throw new Error('Instagram requires at least one media URL');
  }

  const containerRes = await graphPost(`${igAccountId}/media`, {
    image_url: mediaUrls[0],
    caption,
    access_token: accessToken,
  });

  const containerId = containerRes.id as string;

  const publishRes = await graphPost(`${igAccountId}/media_publish`, {
    creation_id: containerId,
    access_token: accessToken,
  });

  return publishRes.id as string;
}

// ─────────────────────────────────────────────
// UNIFIED INBOX - COMMENTS & DMs
// ─────────────────────────────────────────────

/**
 * Fetch recent comments from all posts on a Facebook Page
 */
export async function fetchPageComments({
  pageId,
  accessToken,
  since = null,
}: {
  pageId: string;
  accessToken: string;
  since?: string | null;
}): Promise<FacebookComment[]> {
  const params: Record<string, unknown> = {
    access_token: accessToken,
    fields: 'id,message,from,created_time,can_reply_privately',
    limit: 50,
  };
  if (since) params.since = since;

  const result = await graphGet(`${pageId}/feed`, params);
  const comments: FacebookComment[] = [];

  const posts = result.data as Array<{
    id: string;
    comments?: { data: Array<{ id: string; from?: { name?: string; id?: string }; message: string; created_time: string }> };
  }>;

  for (const post of (posts || [])) {
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
export async function fetchPageDMs({
  pageId,
  accessToken,
}: {
  pageId: string;
  accessToken: string;
}): Promise<FacebookDM[]> {
  const params: Record<string, unknown> = {
    access_token: accessToken,
    fields: 'id,participants,messages{message,from,created_time}',
    limit: 25,
  };

  const result = await graphGet(`${pageId}/conversations`, params);
  const dms: FacebookDM[] = [];

  const convos = result.data as Array<{
    messages?: { data: Array<{ id: string; from?: { id?: string; name?: string }; message: string; created_time: string }> };
    participants?: { data: Array<{ id: string; name?: string }> };
  }>;

  for (const convo of (convos || [])) {
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
export async function replyToComment({
  commentId,
  message,
  accessToken,
}: {
  commentId: string;
  message: string;
  accessToken: string;
}): Promise<Record<string, unknown>> {
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
export async function fetchPostInsights({
  postId,
  accessToken,
}: {
  postId: string;
  accessToken: string;
}): Promise<PostInsights> {
  try {
    const result = await graphGet(`${postId}`, {
      access_token: accessToken,
      fields: 'likes.summary(true),comments.summary(true),shares,insights.metric(post_impressions,post_reach)',
    });

    const r = result as {
      likes?: { summary?: { total_count?: number } };
      comments?: { summary?: { total_count?: number } };
      shares?: { count?: number };
      insights?: { data?: Array<{ name: string; values?: Array<{ value?: number }> }> };
    };

    return {
      likes_count: r.likes?.summary?.total_count || 0,
      comments_count: r.comments?.summary?.total_count || 0,
      shares_count: r.shares?.count || 0,
      impressions: r.insights?.data?.find(m => m.name === 'post_impressions')?.values?.[0]?.value || 0,
      reach: r.insights?.data?.find(m => m.name === 'post_reach')?.values?.[0]?.value || 0,
    };
  } catch {
    return { likes_count: 0, comments_count: 0, shares_count: 0, impressions: 0, reach: 0 };
  }
}

/**
 * Get list of FB Pages a user manages (via user token)
 */
export async function getUserPages(userAccessToken: string): Promise<Record<string, unknown>[]> {
  const result = await graphGet('me/accounts', {
    access_token: userAccessToken,
    fields: 'id,name,access_token,picture,instagram_business_account',
  });
  return (result.data as Record<string, unknown>[]) || [];
}

/**
 * Exchange short-lived token for long-lived token
 */
export async function getLongLivedToken(shortLivedToken: string): Promise<string> {
  const result = await graphGet('oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: process.env.FACEBOOK_APP_ID,
    client_secret: process.env.FACEBOOK_APP_SECRET,
    fb_exchange_token: shortLivedToken,
  });
  return result.access_token as string;
}
