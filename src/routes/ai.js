/**
 * AI Content Generation Routes (No external API key required — uses smart templates)
 * POST /api/ai/generate       - generate post content
 * POST /api/ai/hashtags       - suggest hashtags for content
 * GET  /api/ai/best-time      - best time to post analysis
 * GET  /api/ai/history        - generation history
 * GET  /api/ai/insights       - performance insights & tips
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');

// ─── Content Templates by Tone + Niche ────────────────────────────────────────
const CONTENT_TEMPLATES = {
  promotional: [
    `🎉 Exciting news! {{topic}} is here and we couldn't be more thrilled to share it with you!\n\n✨ Here's what makes it special:\n• {{benefit1}}\n• {{benefit2}}\n• {{benefit3}}\n\nDon't miss out — {{cta}}! 🚀`,
    `💥 Big announcement from {{business}}!\n\nWe're proud to introduce {{topic}} — designed specifically for you.\n\n🔥 Limited time: {{cta}}\n\nTag someone who needs to know about this! 👇`,
    `The wait is over! {{topic}} is finally available.\n\n🌟 Why you'll love it:\n→ {{benefit1}}\n→ {{benefit2}}\n\nVisit us today or call/WhatsApp to learn more. {{cta}}`,
  ],
  educational: [
    `💡 Did you know? {{topic}}\n\nHere are 3 things you should know:\n\n1️⃣ {{point1}}\n2️⃣ {{point2}}\n3️⃣ {{point3}}\n\nSave this post for later! What questions do you have? Drop them below 👇`,
    `📚 Quick tip for {{topic}}:\n\n{{tip}}\n\nThis simple trick can make a huge difference. Have you tried this before? Let us know in the comments! 💬`,
    `🧠 Let's talk about {{topic}}.\n\nMany people don't realize that {{insight}}.\n\nHere's what you can do:\n✅ {{action1}}\n✅ {{action2}}\n\nFollow us for more tips like this every week!`,
  ],
  engaging: [
    `🤔 Quick question for our community:\n\n{{question}}\n\nWe'd love to hear from you! Share your thoughts in the comments below 👇\n\n(And tag a friend who would have an interesting answer!)`,
    `This or That? 🤷\n\n{{option1}} OR {{option2}}?\n\nComment A or B below and tell us why! We're curious to see what our community thinks 🗳️`,
    `Let's settle this once and for all! 😄\n\n{{topic}} — what's your take?\n\nType YES or NO below and tag someone who would disagree with you! 👇`,
  ],
  festival: [
    `🙏 {{festival}} को हार्दिक शुभकामना! / Warm wishes on {{festival}}!\n\nMay this {{festival}} bring joy, prosperity and happiness to you and your family. 🌸\n\n— Team {{business}} 💝`,
    `✨ Happy {{festival}}! 🎊\n\nWishing all our valued customers and friends a blessed {{festival}} filled with love and laughter.\n\n{{business}} is {{hours}} during this festive season. 🕐`,
    `🎊 Celebrating {{festival}} with our amazing community!\n\nThis is a time for gratitude, togetherness and new beginnings.\n\nFrom all of us at {{business}} — {{festival}} को शुभकामना! 🙏`,
  ],
  product: [
    `✨ Introducing {{product_name}}!\n\n{{product_description}}\n\n💰 Price: {{price}}\n📍 Available at: {{location}}\n📞 Contact: {{contact}}\n\nLimited stock available — order now! 🛒`,
    `🆕 NEW ARRIVAL: {{product_name}}\n\n{{product_description}}\n\n🌟 Features:\n• {{feature1}}\n• {{feature2}}\n\nDM us or visit our store to get yours today! 👆`,
    `🛍️ Your new favorite {{product_name}} is here!\n\n{{product_description}}\n\nPerfect for {{use_case}}. Grab yours before it's gone! 🔥\n\n💬 Comment "INFO" for details or call us directly.`,
  ],
  announcement: [
    `📢 Important announcement from {{business}}:\n\n{{announcement}}\n\nWe appreciate your continued support and trust in us. 🙏\n\nFor questions, reach us at {{contact}}.`,
    `🚨 ATTENTION: {{headline}}\n\n{{details}}\n\nEffective from: {{date}}\n\nThank you for your understanding. We're here to help if you have any questions! 💬`,
    `📌 UPDATE: {{topic}}\n\n{{details}}\n\nWe're committed to serving you better every day. Your feedback matters to us!\n\n📞 Contact us anytime: {{contact}}`,
  ],
  story: [
    `Here's a story that might inspire you... 💭\n\n{{story_intro}}\n\n{{story_middle}}\n\nThe lesson? {{lesson}}\n\nHave you had a similar experience? Share in the comments! 👇`,
    `Behind the scenes at {{business}} 🏠\n\n{{behind_scenes}}\n\nEvery day brings new challenges and new wins. We're grateful for every single one of you who supports our journey. ❤️`,
    `Our story began when {{origin_story}}...\n\nToday, we serve {{customer_count}}+ happy customers and we're just getting started! 🚀\n\nThank you for being part of our journey. {{cta}}`,
  ],
};

const NEPALI_HASHTAGS = {
  business: ['#Nepal', '#NepalBusiness', '#Kathmandu', '#SupportLocal', '#MadeInNepal', '#NepalFirst'],
  food: ['#NepalFood', '#NepalCuisine', '#FoodNepal', '#KathmanduFood', '#NepalRestaurant'],
  fashion: ['#NepalFashion', '#NepalStyle', '#KathmanduFashion', '#NepalDesign'],
  festival: ['#Nepal', '#NepalFestival', '#Dashain', '#Tihar', '#Holi', '#Teej'],
  general: ['#Nepal', '#NepalBusiness', '#Kathmandu', '#NepalFlow', '#SocialMedia'],
};

// POST /api/ai/generate
router.post('/generate', authenticate, (req, res) => {
  const {
    topic = '',
    tone = 'promotional',
    platform = 'facebook',
    business_name = 'Our Business',
    niche = 'general',
    language = 'en',
    custom_vars = {},
  } = req.body;

  if (!topic.trim()) return res.status(400).json({ error: 'Topic is required' });

  const templates = CONTENT_TEMPLATES[tone] || CONTENT_TEMPLATES.promotional;
  const template = templates[Math.floor(Math.random() * templates.length)];

  // Replace known variables
  const vars = {
    topic,
    business: business_name,
    benefit1: `High quality ${topic}`,
    benefit2: `Best prices in Nepal`,
    benefit3: `Fast delivery to your doorstep`,
    cta: `Contact us now!`,
    point1: `${topic} can significantly improve your daily routine`,
    point2: `Many Nepali businesses are already benefiting`,
    point3: `Getting started is easier than you think`,
    tip: `When it comes to ${topic}, consistency is key`,
    insight: `${topic} works best when you plan ahead`,
    action1: `Start small and scale up`,
    action2: `Track your progress weekly`,
    question: `What's your experience with ${topic}?`,
    option1: topic,
    option2: 'Something else',
    festival: topic,
    hours: 'open as usual',
    product_name: topic,
    product_description: `Premium quality ${topic} crafted with care`,
    price: 'Contact for price',
    location: 'Kathmandu',
    contact: 'DM us or call/WhatsApp',
    feature1: 'Premium quality materials',
    feature2: 'Locally made in Nepal',
    use_case: 'everyday use',
    announcement: topic,
    headline: topic,
    details: `We are pleased to inform you about ${topic}`,
    date: 'Immediately',
    story_intro: `When we first started thinking about ${topic}...`,
    story_middle: `After months of hard work and dedication...`,
    lesson: `Never give up on what you believe in`,
    behind_scenes: `Every day we work tirelessly to bring you the best ${topic}`,
    origin_story: `we noticed a gap in the ${topic} market in Nepal`,
    customer_count: '500',
    ...custom_vars,
  };

  let content = template;
  for (const [key, val] of Object.entries(vars)) {
    content = content.replace(new RegExp(`{{${key}}}`, 'g'), val);
  }

  // Platform-specific character limit warning
  const limits = { facebook: 63206, instagram: 2200, tiktok: 2200 };
  const limit = limits[platform] || 63206;
  const charCount = content.length;

  // Generate hashtag suggestions
  const nicheHashtags = NEPALI_HASHTAGS[niche] || NEPALI_HASHTAGS.general;
  const toneHashtags = {
    promotional: ['#Offer', '#Deal', '#BuyNow', '#LimitedTime'],
    educational: ['#Tips', '#LearnMore', '#DidYouKnow', '#Education'],
    engaging: ['#CommunityQuestion', '#YourOpinion', '#Poll'],
    festival: ['#Festival', '#Celebration', '#Nepal'],
  }[tone] || [];
  const hashtags = [...new Set([...nicheHashtags, ...toneHashtags])].slice(0, 8);

  // Save to history
  const id = uuidv4();
  db.run(
    'INSERT INTO ai_generations (id, user_id, prompt, result, platform, tone) VALUES (?, ?, ?, ?, ?, ?)',
    [id, req.user.id, `${tone} | ${topic}`, content, platform, tone]
  );

  res.json({
    id,
    content,
    hashtags,
    platform,
    tone,
    char_count: charCount,
    char_limit: limit,
    within_limit: charCount <= limit,
    alternatives: templates
      .filter(t => t !== template)
      .slice(0, 2)
      .map(t => {
        let alt = t;
        for (const [key, val] of Object.entries(vars)) {
          alt = alt.replace(new RegExp(`{{${key}}}`, 'g'), val);
        }
        return alt;
      }),
  });
});

// POST /api/ai/hashtags — suggest hashtags for given content
router.post('/hashtags', authenticate, (req, res) => {
  const { content = '', platform = 'facebook', niche = 'general' } = req.body;
  if (!content.trim()) return res.status(400).json({ error: 'Content is required' });

  const words = content.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  const contentHashtags = [...new Set(words.slice(0, 5).map(w => `#${w.charAt(0).toUpperCase()}${w.slice(1)}`))];

  // Pull user's best-performing hashtags
  const userBest = db.all(
    'SELECT hashtag, use_count, avg_likes FROM hashtag_stats WHERE user_id = ? ORDER BY avg_likes DESC LIMIT 5',
    [req.user.id]
  );

  const nicheHashtags = NEPALI_HASHTAGS[niche] || NEPALI_HASHTAGS.general;
  const instagramHashtags = platform === 'instagram'
    ? ['#nepal', '#nepali', '#kathmandudiaries', '#visitnepal', '#nepalphoto']
    : [];

  const all = [
    ...new Set([
      ...contentHashtags,
      ...userBest.map(h => h.hashtag),
      ...nicheHashtags,
      ...instagramHashtags,
    ]),
  ].slice(0, 15);

  res.json({
    suggested: all,
    your_best: userBest.map(h => ({ hashtag: h.hashtag, avg_likes: Math.round(h.avg_likes) })),
    trending_nepal: nicheHashtags,
  });
});

// GET /api/ai/best-time — analyze when posts perform best
router.get('/best-time', authenticate, (req, res) => {
  const platform = req.query.platform || 'all';

  // Analyze published posts performance by hour + day
  let sql = `
    SELECT
      strftime('%H', p.published_at) as hour,
      strftime('%w', p.published_at) as day_of_week,
      AVG(a.likes_count + a.comments_count * 2 + a.shares_count * 3) as avg_engagement,
      COUNT(*) as post_count
    FROM posts p
    LEFT JOIN analytics a ON a.post_id = p.id
    WHERE p.user_id = ? AND p.status = 'published' AND p.published_at IS NOT NULL
  `;
  const params = [req.user.id];
  if (platform !== 'all') {
    sql += ` AND p.account_id IN (SELECT id FROM social_accounts WHERE user_id = ? AND platform = ?)`;
    params.push(req.user.id, platform);
  }
  sql += ' GROUP BY hour, day_of_week ORDER BY avg_engagement DESC';

  const data = db.all(sql, params);

  // Best hours (from actual data or defaults for Nepal market)
  const nepalDefaults = [
    { hour: '07', day: '1', label: 'Monday morning', score: 85 },
    { hour: '12', day: '3', label: 'Wednesday noon', score: 90 },
    { hour: '18', day: '5', label: 'Friday evening', score: 95 },
    { hour: '19', day: '6', label: 'Saturday evening', score: 88 },
    { hour: '20', day: '0', label: 'Sunday evening', score: 82 },
  ];

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const bestTimes = data.length >= 3
    ? data.slice(0, 5).map(d => ({
        hour: parseInt(d.hour),
        day: DAYS[parseInt(d.day_of_week)],
        avg_engagement: Math.round(d.avg_engagement || 0),
        post_count: d.post_count,
        label: `${DAYS[parseInt(d.day_of_week)]} at ${d.hour}:00`,
        score: Math.min(100, Math.round((d.avg_engagement || 0) * 10)),
      }))
    : nepalDefaults.map(d => ({ ...d, hour: parseInt(d.hour), day: DAYS[parseInt(d.day)], note: 'Nepal market average' }));

  // Heatmap data (24h × 7days grid)
  const heatmap = Array.from({ length: 7 }, (_, day) =>
    Array.from({ length: 24 }, (_, hour) => {
      const found = data.find(d => parseInt(d.hour) === hour && parseInt(d.day_of_week) === day);
      return { day, hour, value: found ? Math.round(found.avg_engagement || 0) : 0 };
    })
  ).flat();

  res.json({
    best_times: bestTimes,
    heatmap,
    days: DAYS,
    has_real_data: data.length >= 3,
    tips: [
      'Post between 6-9 AM when Nepali users start their day',
      'Evening posts (6-9 PM) get 40% more engagement in Nepal',
      'Friday and Saturday evenings are peak times for Nepali social media',
      'Avoid posting between 2-5 AM (very low activity)',
      'Festival days see 3x normal engagement — plan ahead!',
    ],
  });
});

// GET /api/ai/history — AI generation history
router.get('/history', authenticate, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const generations = db.all(
    'SELECT id, prompt, result, platform, tone, used, created_at FROM ai_generations WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [req.user.id, limit]
  );
  res.json({ generations });
});

// GET /api/ai/insights — smart performance insights
router.get('/insights', authenticate, (req, res) => {
  const days = parseInt(req.query.days) || 30;

  const totalPosts = db.get(
    "SELECT COUNT(*) as count FROM posts WHERE user_id = ? AND created_at >= datetime('now', ?)",
    [req.user.id, `-${days} days`]
  );
  const publishedPosts = db.get(
    "SELECT COUNT(*) as count FROM posts WHERE user_id = ? AND status = 'published' AND published_at >= datetime('now', ?)",
    [req.user.id, `-${days} days`]
  );
  const failedPosts = db.get(
    "SELECT COUNT(*) as count FROM posts WHERE user_id = ? AND status = 'failed' AND updated_at >= datetime('now', ?)",
    [req.user.id, `-${days} days`]
  );
  const avgEngagement = db.get(
    `SELECT AVG(a.likes_count + a.comments_count + a.shares_count) as avg_eng
     FROM analytics a
     JOIN posts p ON a.post_id = p.id
     WHERE p.user_id = ? AND p.published_at >= datetime('now', ?)`,
    [req.user.id, `-${days} days`]
  );
  const topHashtag = db.get(
    'SELECT hashtag, avg_likes FROM hashtag_stats WHERE user_id = ? ORDER BY avg_likes DESC LIMIT 1',
    [req.user.id]
  );
  const inboxUnread = db.get(
    `SELECT COUNT(*) as count FROM comments c
     JOIN social_accounts sa ON c.account_id = sa.id
     WHERE sa.user_id = ? AND c.is_read = 0`,
    [req.user.id]
  );

  const insights = [];
  const published = publishedPosts?.count || 0;
  const total = totalPosts?.count || 0;
  const failed = failedPosts?.count || 0;
  const unread = inboxUnread?.count || 0;
  const avgEng = Math.round(avgEngagement?.avg_eng || 0);

  if (total === 0) {
    insights.push({ type: 'info', icon: '🚀', title: 'Get Started', message: 'Schedule your first post to start seeing insights and performance data.' });
  } else {
    if (published / Math.max(total, 1) < 0.5) {
      insights.push({ type: 'warning', icon: '⚠️', title: 'Low Publishing Rate', message: `Only ${published} of ${total} posts were published. Check for failed posts and fix token issues.` });
    }
    if (failed > 2) {
      insights.push({ type: 'error', icon: '🔴', title: 'Posts Failing', message: `${failed} posts failed to publish. Your social account tokens may have expired — reconnect your accounts.` });
    }
    if (published >= 5 && avgEng > 0) {
      insights.push({ type: 'success', icon: '📈', title: 'Engagement Stats', message: `Your posts average ${avgEng} engagements. ${avgEng > 10 ? 'Great job!' : 'Try more engaging content.'}` });
    }
    if (unread > 5) {
      insights.push({ type: 'warning', icon: '💬', title: 'Unread Messages', message: `You have ${unread} unread messages. Responding quickly improves engagement by up to 40%!` });
    }
    if (topHashtag) {
      insights.push({ type: 'info', icon: '🏷️', title: 'Best Hashtag', message: `"${topHashtag.hashtag}" is your top performer with ${Math.round(topHashtag.avg_likes)} avg likes. Use it more!` });
    }
    if (published >= 10) {
      insights.push({ type: 'success', icon: '🌟', title: 'Consistency Champion', message: `You've published ${published} posts in ${days} days. Consistent posting grows audiences 3x faster!` });
    }
  }

  res.json({
    insights,
    summary: {
      total_posts: total,
      published,
      failed,
      avg_engagement: avgEng,
      unread_messages: unread,
      best_hashtag: topHashtag?.hashtag || null,
    },
  });
});

module.exports = router;
