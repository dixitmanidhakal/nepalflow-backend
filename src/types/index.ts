export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  provider: string;
  provider_id: string | null;
  language: string;
  timezone: string | null;
  bio: string | null;
  website: string | null;
  fb_access_token: string | null;
  created_at: string;
  updated_at: string;
}

export interface SocialAccount {
  id: string;
  user_id: string;
  platform: string;
  account_id: string;
  account_name: string;
  access_token: string;
  token_expires: string | null;
  profile_pic: string | null;
  followers_count: number;
  is_active: number;
  created_at: string;
}

export interface Post {
  id: string;
  user_id: string;
  account_id: string;
  content: string;
  media_urls: string;
  platform_post_id: string | null;
  status: string;
  approval_status: string | null;
  scheduled_at: string;
  published_at: string | null;
  error_message: string | null;
  hashtags: string;
  template_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: string;
  post_id: string | null;
  account_id: string;
  platform_comment_id: string | null;
  commenter_name: string;
  commenter_id: string | null;
  commenter_pic: string | null;
  message: string;
  comment_type: string;
  is_read: number;
  is_replied: number;
  reply_text: string | null;
  auto_replied: number;
  platform_time: string | null;
  fetched_at: string;
}

export interface Analytics {
  id: string;
  post_id: string;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  reach: number;
  impressions: number;
  clicks: number;
  saves: number;
  recorded_at: string;
}

export interface Template {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  content: string;
  platforms: string;
  hashtags: string;
  category: string;
  is_public: number;
  use_count: number;
  created_at: string;
  updated_at: string;
}

export interface AutoResponder {
  id: string;
  user_id: string;
  account_id: string | null;
  name: string;
  trigger_type: string;
  keywords: string;
  response: string;
  platforms: string;
  match_type: string;
  is_active: number;
  match_count: number;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  icon: string | null;
  is_read: number;
  created_at: string;
}

export interface RssFeed {
  id: string;
  user_id: string;
  account_id: string | null;
  name: string;
  feed_url: string;
  is_active: number;
  auto_post: number;
  post_template: string | null;
  hashtags: string;
  last_fetched: string | null;
  last_item_id: string | null;
  fetch_count: number;
  created_at: string;
}

export interface PostQueue {
  id: string;
  user_id: string;
  account_id: string | null;
  content: string;
  media_urls: string;
  hashtags: string;
  scheduled_at: string;
  status: string;
  post_id: string | null;
  error: string | null;
  created_at: string;
}

export interface AiGeneration {
  id: string;
  user_id: string;
  prompt: string;
  result: string;
  platform: string | null;
  tone: string | null;
  used: number;
  created_at: string;
}

// Express / Passport augmentation
// Augment Express.User (used by passport for req.user) with our User fields.
// Augment Request with the socialAccount property added by our auth middleware.
declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      name: string;
      avatar_url: string | null;
      provider: string;
      provider_id: string | null;
      language: string;
      timezone: string | null;
      bio: string | null;
      website: string | null;
      fb_access_token: string | null;
      created_at: string;
      updated_at: string;
    }
    interface Request {
      socialAccount?: SocialAccount;
    }
  }
}
