/**
 * AI Content Generation Routes — Powered by Groq (llama-3.3-70b-versatile)
 */

import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';
import db from '../db/database';
import { authenticate } from '../middleware/auth';

const router = express.Router();

// ─── Groq Client (OpenAI-compatible) ──────────────────────────────────────────
const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

const groqClient = GROQ_KEY && !GROQ_KEY.includes('your_groq') && !GROQ_KEY.includes('_here')
  ? new OpenAI({
      apiKey: GROQ_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
    })
  : null;

// ─── Fallback Template Engine ─────────────────────────────────────────────────
const FALLBACK_TEMPLATES: Record<string, string[]> = {
  promotional: [
    `🎉 Exciting news! {{topic}} is here!\n\n✨ Why you'll love it:\n• High quality, crafted for Nepal\n• Best prices guaranteed\n• Fast delivery nationwide\n\nDon't miss out — Contact us now! 🚀`,
    `💥 Big announcement from {{business}}!\n\nWe're proud to introduce {{topic}} — made just for you.\n\n🔥 Limited time offer!\n\nTag someone who needs to know about this! 👇`,
  ],
  educational: [
    `💡 Did you know? {{topic}}\n\n3 things every Nepali business owner should know:\n\n1️⃣ Planning ahead makes all the difference\n2️⃣ Consistency is the key to growth\n3️⃣ Your community is your biggest asset\n\nSave this! Drop your questions below 👇`,
  ],
  engaging: [
    `🤔 Quick question for our community:\n\nWhat's your experience with {{topic}}?\n\nShare your thoughts below 👇 Tag a friend who'd have an interesting answer!`,
  ],
  festival: [
    `🙏 {{topic}} को हार्दिक शुभकामना! / Warm wishes on {{topic}}!\n\nMay this bring joy, prosperity and happiness to you and your family. 🌸\n\n— Team {{business}} 💝`,
  ],
  story: [
    `Behind the scenes at {{business}} 🏠\n\nEvery day we work hard to bring you the best {{topic}}. We're grateful for your support! ❤️`,
  ],
};

const NEPALI_HASHTAGS: Record<string, string[]> = {
  business:    ['#Nepal', '#NepalBusiness', '#Kathmandu', '#SupportLocal', '#MadeInNepal', '#NepalFirst', '#GrowNepal'],
  food:        ['#NepalFood', '#NepalCuisine', '#FoodNepal', '#KathmanduFood', '#NepalRestaurant', '#DalBhat'],
  fashion:     ['#NepalFashion', '#NepalStyle', '#KathmanduFashion', '#NepalDesign', '#HandmadeNepal'],
  festival:    ['#Nepal', '#NepalFestival', '#Dashain', '#Tihar', '#Holi', '#Teej', '#Nepali'],
  tech:        ['#NepalTech', '#StartupNepal', '#TechNepal', '#DigitalNepal', '#ITNepal', '#KathmanduTech'],
  travel:      ['#VisitNepal', '#Nepal', '#NepalTravel', '#Himalayas', '#Trekking', '#ExploreNepal'],
  beauty:      ['#NepalBeauty', '#Kathmandu', '#NepalMakeup', '#BeautyNepal', '#NaturalBeauty'],
  real_estate: ['#NepalRealEstate', '#KathmanduProperty', '#Nepal', '#NepalHomes', '#PropertyNepal'],
  general:     ['#Nepal', '#NepalBusiness', '#Kathmandu', '#NepalFlow', '#SocialMedia', '#GrowWithNepal'],
};

interface GroqOpts {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

// ─── Helper: Call Groq ────────────────────────────────────────────────────────
async function callGroq(systemPrompt: string, userPrompt: string, opts: GroqOpts = {}): Promise<string | null> {
  if (!groqClient) return null;
  const resp = await groqClient.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    temperature: opts.temperature ?? 0.85,
    max_tokens:  opts.maxTokens  ?? 1024,
    top_p:       opts.topP       ?? 0.95,
  });
  return resp.choices[0]?.message?.content?.trim() || null;
}

// ─── Helper: Fallback template ────────────────────────────────────────────────
function useFallback(topic: string, tone: string, business: string): string {
  const tpls = FALLBACK_TEMPLATES[tone] || FALLBACK_TEMPLATES.promotional;
  return tpls[Math.floor(Math.random() * tpls.length)]
    .replace(/\{\{topic\}\}/g, topic)
    .replace(/\{\{business\}\}/g, business || 'Our Business');
}

// ─── System prompt builder ────────────────────────────────────────────────────
function buildSysPrompt(platform: string, tone: string, language: string): string {
  const platformGuide: Record<string, string> = {
    facebook:  'Facebook: conversational, 1-3 paragraphs, stories work well. Max 400 words.',
    instagram: 'Instagram: punchy opener, emojis, line breaks, CTA at end. Max 250 words.',
    tiktok:    'TikTok: hook in first line, very concise, trendy. Max 100 words visible.',
  };

  const toneGuide: Record<string, string> = {
    promotional:  'Salesy but genuine. Create urgency. Clear call-to-action.',
    educational:  'Informative, accessible. Use numbered lists. Teach something.',
    engaging:     'Ask questions. Encourage comments. Be relatable.',
    festival:     'Warm, celebratory. Mix English and Nepali greetings.',
    product:      'Feature-focused, benefit-driven. Address pain points.',
    announcement: 'Clear, professional. State news first then details.',
    story:        'Narrative, personal. Show vulnerability and humanity.',
  };

  const langNote = language === 'ne'
    ? 'Write PRIMARILY in Nepali (Devanagari script) with minimal English.'
    : 'Write in English. Sprinkle occasional Nepali words like "Namaste", "Dhanyabad" for authenticity.';

  return `You are an expert social media content creator for Nepali businesses.
PLATFORM: ${platformGuide[platform] || 'Facebook: conversational, 1-3 paragraphs.'}
TONE: ${toneGuide[tone] || 'Genuine and engaging.'}
LANGUAGE: ${langNote}
RULES:
- Sound genuine, not AI-generated
- Use emojis naturally
- Understand Nepali culture: family values, community pride, festival importance
- Do NOT include hashtags in post body
- Do NOT use placeholder text like [business name]
- Return ONLY the post content, no explanations`;
}

// ─── POST /api/ai/generate ────────────────────────────────────────────────────
router.post('/generate', authenticate, async (req: Request, res: Response) => {
  const {
    topic = '',
    tone = 'promotional',
    platform = 'facebook',
    business_name = '',
    niche = 'general',
    language = 'en',
    additional_context = '',
  } = req.body as {
    topic?: string;
    tone?: string;
    platform?: string;
    business_name?: string;
    niche?: string;
    language?: string;
    additional_context?: string;
  };

  if (!topic.trim()) return res.status(400).json({ error: 'Topic is required' });

  const limits: Record<string, number> = { facebook: 63206, instagram: 2200, tiktok: 2200 };
  const limit = limits[platform] || 63206;

  if (groqClient) {
    try {
      const raw = await callGroq(
        buildSysPrompt(platform, tone, language),
        `Create a ${tone} social media post for ${platform} about: "${topic}"
${business_name ? `Business: ${business_name}` : ''}
${additional_context ? `Context: ${additional_context}` : ''}

Write 3 variations separated by "---VARIANT---". Each should differ in approach and style.`,
        { maxTokens: 1600 }
      );

      if (raw) {
        const variants = raw.split('---VARIANT---').map((v: string) => v.trim()).filter(Boolean);
        const content = variants[0];

        const id = uuidv4();
        db.run(
          'INSERT INTO ai_generations (id, user_id, prompt, result, platform, tone) VALUES (?, ?, ?, ?, ?, ?)',
          [id, req.user!.id, `${tone} | ${topic}`, content, platform, tone]
        );

        const hashRaw = await callGroq(
          'You are a hashtag expert for Nepal market social media.',
          `Generate 10 relevant hashtags for a ${platform} post about "${topic}" targeting Nepal. Comma-separated, start with #. Return ONLY hashtags.`,
          { temperature: 0.4, maxTokens: 200 }
        );
        const aiTags = hashRaw
          ? hashRaw.split(/[,\s\n]+/).map((h: string) => h.trim()).filter((h: string) => h.startsWith('#')).slice(0, 10)
          : [];

        const hashtags = [...new Set([...aiTags, ...(NEPALI_HASHTAGS[niche] || NEPALI_HASHTAGS.general)])].slice(0, 12);

        return res.json({
          id, content, hashtags, platform, tone,
          char_count: content.length, char_limit: limit,
          within_limit: content.length <= limit,
          alternatives: variants.slice(1),
          ai_powered: true, model: GROQ_MODEL,
        });
      }
    } catch (err: unknown) {
      console.error('[Groq Error] generate:', (err as Error).message);
    }
  }

  const content = useFallback(topic, tone, business_name);
  const toneHashtags: Record<string, string[]> = {
    promotional: ['#Offer', '#Deal', '#BuyNow'],
    educational: ['#Tips', '#LearnMore'],
    engaging:    ['#Poll', '#Question'],
  };
  const hashtags = [...new Set([
    ...(NEPALI_HASHTAGS[niche] || NEPALI_HASHTAGS.general),
    ...(toneHashtags[tone] || []),
  ])].slice(0, 8);

  const id = uuidv4();
  db.run(
    'INSERT INTO ai_generations (id, user_id, prompt, result, platform, tone) VALUES (?, ?, ?, ?, ?, ?)',
    [id, req.user!.id, `${tone} | ${topic}`, content, platform, tone]
  );

  res.json({
    id, content, hashtags, platform, tone,
    char_count: content.length, char_limit: limit, within_limit: content.length <= limit,
    alternatives: [],
    ai_powered: false,
    note: groqClient ? 'Groq temporarily unavailable, using templates' : 'Set GROQ_API_KEY in .env to enable Groq AI',
  });
});

// ─── POST /api/ai/rewrite ─────────────────────────────────────────────────────
router.post('/rewrite', authenticate, async (req: Request, res: Response) => {
  const {
    content = '',
    instruction = 'improve',
    platform = 'facebook',
    language = 'en',
  } = req.body as { content?: string; instruction?: string; platform?: string; language?: string };

  if (!content.trim()) return res.status(400).json({ error: 'Content is required' });

  if (!groqClient) {
    return res.status(503).json({ error: 'Groq AI not configured', message: 'Add GROQ_API_KEY to .env to enable AI rewriting' });
  }

  const instructionMap: Record<string, string> = {
    improve:     'Improve writing quality, fix grammar, make more engaging.',
    shorten:     'Make concise and punchy. Max 100 words. Keep key points only.',
    expand:      'Expand into detailed, story-driven post with emotion and context.',
    make_viral:  'Rewrite for maximum virality: strong hook, emotional resonance, shareable ending.',
    add_emotion: 'Add emotional depth, warmth, human connection.',
    formal:      'Rewrite in professional formal business tone.',
    casual:      'Rewrite in casual friendly conversational tone like talking to a friend.',
    nepali:      'Translate and adapt into natural Nepali (Devanagari script).',
    english:     'Translate into clear natural English.',
  };

  try {
    const rewritten = await callGroq(
      `You are an expert social media copywriter for Nepal market.
${buildSysPrompt(platform, 'promotional', language)}
Task: ${instructionMap[instruction] || instructionMap.improve}
Return ONLY the rewritten content.`,
      `Rewrite this ${platform} post:\n\n"${content}"`,
      { temperature: 0.8, maxTokens: 800 }
    );
    if (!rewritten) throw new Error('Empty response');
    res.json({ original: content, rewritten, instruction, char_count: rewritten.length, ai_powered: true, model: GROQ_MODEL });
  } catch (err: unknown) {
    console.error('[Groq Error] rewrite:', (err as Error).message);
    res.status(503).json({ error: 'Rewrite failed', details: (err as Error).message });
  }
});

// ─── POST /api/ai/hashtags ────────────────────────────────────────────────────
router.post('/hashtags', authenticate, async (req: Request, res: Response) => {
  const { content = '', platform = 'facebook', niche = 'general' } = req.body as { content?: string; platform?: string; niche?: string };
  if (!content.trim()) return res.status(400).json({ error: 'Content is required' });

  const userBest = db.all<{ hashtag: string; use_count: number; avg_likes: number }>(
    'SELECT hashtag, use_count, avg_likes FROM hashtag_stats WHERE user_id = ? ORDER BY avg_likes DESC LIMIT 5',
    [req.user!.id]
  );
  const nicheHashtags = NEPALI_HASHTAGS[niche] || NEPALI_HASHTAGS.general;

  let aiTags: string[] = [];
  if (groqClient) {
    try {
      const raw = await callGroq(
        'You are a hashtag research expert for Nepal social media.',
        `Suggest 15 optimal hashtags for this ${platform} post targeting Nepal market.
Mix: popular (high reach), medium, and niche tags.
Post: "${content.slice(0, 400)}"
Niche: ${niche}
Return ONLY hashtags comma-separated starting with #.`,
        { temperature: 0.4, maxTokens: 300 }
      );
      if (raw) aiTags = raw.split(/[,\s\n]+/).map((h: string) => h.trim()).filter((h: string) => h.startsWith('#'));
    } catch (err: unknown) {
      console.error('[Groq Error] hashtags:', (err as Error).message);
    }
  }

  if (!aiTags.length) {
    const words = content.toLowerCase().split(/\W+/).filter((w: string) => w.length > 3);
    aiTags = [...new Set(words.slice(0, 5).map((w: string) => `#${w.charAt(0).toUpperCase()}${w.slice(1)}`))];
  }

  const extra = platform === 'instagram'
    ? ['#nepal', '#nepali', '#kathmandudiaries', '#visitnepal2026', '#nepalphoto', '#ig_nepal']
    : [];

  const all = [...new Set([...aiTags, ...userBest.map(h => h.hashtag), ...nicheHashtags, ...extra])].slice(0, 20);

  res.json({
    suggested: all,
    your_best: userBest.map(h => ({ hashtag: h.hashtag, avg_likes: Math.round(h.avg_likes) })),
    trending_nepal: nicheHashtags,
    ai_powered: !!groqClient,
  });
});

// ─── POST /api/ai/reply-suggestion ───────────────────────────────────────────
router.post('/reply-suggestion', authenticate, async (req: Request, res: Response) => {
  const {
    comment = '',
    post_content = '',
    commenter_name = '',
    platform = 'facebook',
    tone = 'friendly',
    business_name = '',
  } = req.body as {
    comment?: string;
    post_content?: string;
    commenter_name?: string;
    platform?: string;
    tone?: string;
    business_name?: string;
  };

  if (!comment.trim()) return res.status(400).json({ error: 'Comment is required' });

  if (!groqClient) {
    return res.json({
      suggestions: [
        `Thank you so much for your comment! 🙏 We really appreciate your support. Please feel free to DM us for more information.`,
        `Dhanyabad ${commenter_name || ''}! 🙏 We're so glad to hear from you. Reach out to us directly for any questions!`,
        `Thank you for your kind words! Your support means everything to us. 💙`,
      ],
      ai_powered: false,
      note: 'Set GROQ_API_KEY in .env for AI-generated replies',
    });
  }

  const toneMap: Record<string, string> = {
    friendly:     'warm, friendly, personable',
    professional: 'professional and courteous',
    playful:      'fun, playful, energetic with emojis',
    formal:       'formal and business-like',
  };

  try {
    const raw = await callGroq(
      `You are a social media manager for "${business_name || 'a Nepali business'}" on ${platform}.
Write authentic, genuine replies to customer comments. Tone: ${toneMap[tone] || toneMap.friendly}.
Keep replies to 1-3 sentences. Include emojis. Occasionally use Nepali: "Dhanyabad", "Namaste", "Shukriya".
Be human, not robotic.`,
      `Generate 3 different reply options to this comment.
${post_content ? `Post was about: "${post_content.slice(0, 100)}"` : ''}
Comment from ${commenter_name || 'a customer'}: "${comment}"

Return exactly 3 replies, each on a new line starting with "REPLY:"`,
      { temperature: 0.9, maxTokens: 500 }
    );

    let suggestions = raw
      ? raw.split('\n').filter((l: string) => l.trim().startsWith('REPLY:')).map((l: string) => l.replace(/^REPLY:\s*/i, '').trim()).filter(Boolean)
      : [];

    if (!suggestions.length && raw) suggestions = [raw.trim()];

    res.json({ suggestions: suggestions.slice(0, 3), ai_powered: true, model: GROQ_MODEL });
  } catch (err: unknown) {
    console.error('[Groq Error] reply-suggestion:', (err as Error).message);
    res.status(503).json({ error: 'Reply generation failed', details: (err as Error).message });
  }
});

// ─── POST /api/ai/translate ───────────────────────────────────────────────────
router.post('/translate', authenticate, async (req: Request, res: Response) => {
  const { content = '', target_language = 'ne', preserve_emojis = true } = req.body as {
    content?: string;
    target_language?: string;
    preserve_emojis?: boolean;
  };
  if (!content.trim()) return res.status(400).json({ error: 'Content is required' });

  if (!groqClient) {
    return res.status(503).json({ error: 'Groq AI not configured', message: 'Add GROQ_API_KEY to .env' });
  }

  try {
    const targetName = target_language === 'ne' ? 'Nepali (Devanagari script)' : 'English';
    const translated = await callGroq(
      `You are an expert Nepali ↔ English social media translator.
Translate naturally and idiomatically, not word-for-word.
${preserve_emojis ? 'Preserve all emojis.' : ''}
Keep hashtags in original form. Return ONLY the translated content.`,
      `Translate to ${targetName}:\n\n"${content}"`,
      { temperature: 0.3, maxTokens: 1000 }
    );
    res.json({ original: content, translated, target_language, ai_powered: true, model: GROQ_MODEL });
  } catch (err: unknown) {
    console.error('[Groq Error] translate:', (err as Error).message);
    res.status(503).json({ error: 'Translation failed', details: (err as Error).message });
  }
});

// ─── POST /api/ai/caption ─────────────────────────────────────────────────────
router.post('/caption', authenticate, async (req: Request, res: Response) => {
  const {
    image_description = '',
    platform = 'instagram',
    tone = 'engaging',
    business_name = '',
    count = 3,
  } = req.body as {
    image_description?: string;
    platform?: string;
    tone?: string;
    business_name?: string;
    count?: number;
  };

  if (!image_description.trim()) return res.status(400).json({ error: 'Image description is required' });

  if (!groqClient) {
    return res.json({
      captions: [
        `✨ Moments like these make everything worthwhile. 🙏\n\nShare your thoughts below! 👇`,
        `Every picture tells a story. What does this one say to you? 💬`,
        `Grateful for moments like this. Thank you for being part of our journey! ❤️`,
      ].slice(0, count),
      ai_powered: false,
    });
  }

  try {
    const raw = await callGroq(
      buildSysPrompt(platform, tone, 'en'),
      `Generate ${count} ${tone} captions for ${platform} for this image: "${image_description}"
${business_name ? `Brand: ${business_name}` : ''}
Make each unique. Separate with "---CAPTION---". Do NOT include hashtags.`,
      { temperature: 0.9, maxTokens: 800 }
    );
    const captions = raw
      ? raw.split('---CAPTION---').map((c: string) => c.trim()).filter(Boolean).slice(0, count)
      : [];
    res.json({ captions, ai_powered: true, model: GROQ_MODEL });
  } catch (err: unknown) {
    console.error('[Groq Error] caption:', (err as Error).message);
    res.status(503).json({ error: 'Caption generation failed', details: (err as Error).message });
  }
});

// ─── POST /api/ai/auto-responder-suggestion ───────────────────────────────────
router.post('/auto-responder-suggestion', authenticate, async (req: Request, res: Response) => {
  const { business_type = 'general', platform = 'facebook' } = req.body as { business_type?: string; platform?: string };

  if (!groqClient) {
    return res.json({
      suggestions: [
        { name: 'Welcome New Commenters', trigger_type: 'first_time', keywords: [], response: 'Namaste! 🙏 Welcome! Thank you for your first comment. Feel free to DM us anytime!' },
        { name: 'Price Inquiry Auto-Reply', trigger_type: 'keyword', keywords: ['price', 'cost', 'rate', 'how much', 'kati'], response: 'Thank you for asking! 🙏 Please DM us or WhatsApp for pricing details. Happy to help!' },
        { name: 'Order Interest Reply', trigger_type: 'keyword', keywords: ['order', 'buy', 'purchase', 'want', 'kina'], response: "We'd love to help you! 🛒 Please DM us your details and we'll get back shortly. Dhanyabad! 🙏" },
        { name: 'Delivery Question Reply', trigger_type: 'keyword', keywords: ['delivery', 'ship', 'deliver', 'send', 'pathaunus'], response: 'Yes, we deliver! 🚚 We ship across Nepal. DM us your location for delivery details. 📍' },
      ],
      ai_powered: false,
    });
  }

  try {
    const raw = await callGroq(
      'You are a social media automation expert for Nepali businesses.',
      `Suggest 5 smart auto-responder rules for a ${business_type} business on ${platform} in Nepal.

For each rule return JSON with:
- name: descriptive rule name
- trigger_type: "keyword" | "first_time" | "any_comment"
- keywords: array of trigger words (include Nepali romanized like "kati", "kina", "pathaunus")
- response: auto-reply message (max 200 chars, include emoji, may mix English/Nepali)
- reason: why this rule helps

Return ONLY a valid JSON array. No markdown, no explanation.`,
      { temperature: 0.6, maxTokens: 1200 }
    );

    let suggestions: unknown[] = [];
    try {
      const match = raw?.match(/\[[\s\S]*\]/);
      if (match) suggestions = JSON.parse(match[0]) as unknown[];
    } catch { /* ignore */ }

    res.json({ suggestions, ai_powered: true, model: GROQ_MODEL });
  } catch (err: unknown) {
    console.error('[Groq Error] auto-responder-suggestion:', (err as Error).message);
    res.status(503).json({ error: 'Suggestion failed', details: (err as Error).message });
  }
});

// ─── GET /api/ai/best-time ────────────────────────────────────────────────────
router.get('/best-time', authenticate, (req: Request, res: Response) => {
  const platform = String(req.query.platform || 'all');
  let sql = `
    SELECT strftime('%H', p.published_at) as hour, strftime('%w', p.published_at) as day_of_week,
      AVG(a.likes_count + a.comments_count * 2 + a.shares_count * 3) as avg_engagement, COUNT(*) as post_count
    FROM posts p LEFT JOIN analytics a ON a.post_id = p.id
    WHERE p.user_id = ? AND p.status = 'published' AND p.published_at IS NOT NULL`;
  const params: unknown[] = [req.user!.id];
  if (platform !== 'all') { sql += ' AND p.account_id IN (SELECT id FROM social_accounts WHERE user_id = ? AND platform = ?)'; params.push(req.user!.id, platform); }
  sql += ' GROUP BY hour, day_of_week ORDER BY avg_engagement DESC';

  const data = db.all<{ hour: string; day_of_week: string; avg_engagement: number; post_count: number }>(sql, params);
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const nepalDefaults = [
    { hour: '07', day: '1', label: 'Monday morning commute', score: 85 },
    { hour: '12', day: '3', label: 'Wednesday lunch break', score: 88 },
    { hour: '18', day: '5', label: 'Friday evening prime time', score: 97 },
    { hour: '19', day: '6', label: 'Saturday evening', score: 93 },
    { hour: '20', day: '0', label: 'Sunday family time', score: 82 },
    { hour: '09', day: '2', label: 'Tuesday morning', score: 78 },
  ];

  const bestTimes = data.length >= 3
    ? data.slice(0, 6).map(d => ({ hour: parseInt(d.hour), day: DAYS[parseInt(d.day_of_week)], avg_engagement: Math.round(d.avg_engagement || 0), post_count: d.post_count, label: `${DAYS[parseInt(d.day_of_week)]} at ${d.hour}:00`, score: Math.min(100, Math.round((d.avg_engagement || 0) * 10)) }))
    : nepalDefaults.map(d => ({ ...d, hour: parseInt(d.hour), day: DAYS[parseInt(d.day)], note: 'Nepal market average' }));

  const heatmap = Array.from({ length: 7 }, (_, day) =>
    Array.from({ length: 24 }, (_, hour) => {
      const found = data.find(d => parseInt(d.hour) === hour && parseInt(d.day_of_week) === day);
      return { day, hour, value: found ? Math.round(found.avg_engagement || 0) : 0 };
    })
  ).flat();

  res.json({
    best_times: bestTimes, heatmap, days: DAYS, has_real_data: data.length >= 3, groq_available: !!groqClient,
    tips: [
      'Post between 6–9 AM when Nepali users start their day with chai ☕',
      'Evening posts (6–9 PM) get 40% more engagement in Nepal',
      'Friday and Saturday evenings are peak times for Nepali social media',
      'Festival days see 3× normal engagement — schedule content in advance!',
      'Avoid posting between 2–5 AM (very low activity in Nepal)',
    ],
  });
});

// ─── GET /api/ai/history ──────────────────────────────────────────────────────
router.get('/history', authenticate, (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit)) || 10, 50);
  const generations = db.all(
    'SELECT id, prompt, result, platform, tone, used, created_at FROM ai_generations WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    [req.user!.id, limit]
  );
  res.json({ generations, groq_available: !!groqClient });
});

// ─── GET /api/ai/insights ─────────────────────────────────────────────────────
router.get('/insights', authenticate, async (req: Request, res: Response) => {
  const days = parseInt(String(req.query.days)) || 30;
  const total      = db.get<{ count: number }>("SELECT COUNT(*) as count FROM posts WHERE user_id = ? AND created_at >= datetime('now', ?)", [req.user!.id, `-${days} days`])?.count || 0;
  const published  = db.get<{ count: number }>("SELECT COUNT(*) as count FROM posts WHERE user_id = ? AND status = 'published' AND published_at >= datetime('now', ?)", [req.user!.id, `-${days} days`])?.count || 0;
  const failed     = db.get<{ count: number }>("SELECT COUNT(*) as count FROM posts WHERE user_id = ? AND status = 'failed' AND updated_at >= datetime('now', ?)", [req.user!.id, `-${days} days`])?.count || 0;
  const avgEng     = Math.round(db.get<{ avg_eng: number }>(`SELECT AVG(a.likes_count + a.comments_count + a.shares_count) as avg_eng FROM analytics a JOIN posts p ON a.post_id = p.id WHERE p.user_id = ? AND p.published_at >= datetime('now', ?)`, [req.user!.id, `-${days} days`])?.avg_eng || 0);
  const topHashtag = db.get<{ hashtag: string; avg_likes: number }>('SELECT hashtag, avg_likes FROM hashtag_stats WHERE user_id = ? ORDER BY avg_likes DESC LIMIT 1', [req.user!.id]);
  const unread     = db.get<{ count: number }>(`SELECT COUNT(*) as count FROM comments c JOIN social_accounts sa ON c.account_id = sa.id WHERE sa.user_id = ? AND c.is_read = 0`, [req.user!.id])?.count || 0;

  const insights: Array<{ type: string; icon: string; title: string; message: string }> = [];
  if (total === 0) {
    insights.push({ type: 'info', icon: '🚀', title: 'Get Started', message: 'Schedule your first post to start seeing insights.' });
  } else {
    if (published / Math.max(total, 1) < 0.5) insights.push({ type: 'warning', icon: '⚠️', title: 'Low Publishing Rate', message: `Only ${published} of ${total} posts published. Check for failed posts.` });
    if (failed > 2) insights.push({ type: 'error', icon: '🔴', title: 'Posts Failing', message: `${failed} posts failed. Social account tokens may have expired — reconnect accounts.` });
    if (published >= 5 && avgEng > 0) insights.push({ type: 'success', icon: '📈', title: 'Engagement Stats', message: `Your posts average ${avgEng} engagements. ${avgEng > 10 ? 'Excellent!' : 'Try questions or polls for more engagement.'}` });
    if (unread > 5) insights.push({ type: 'warning', icon: '💬', title: 'Unread Messages', message: `You have ${unread} unread messages. Fast replies boost engagement by 40%!` });
    if (topHashtag) insights.push({ type: 'info', icon: '🏷️', title: 'Best Hashtag', message: `"${topHashtag.hashtag}" averages ${Math.round(topHashtag.avg_likes)} likes. Use it consistently!` });
    if (published >= 10) insights.push({ type: 'success', icon: '🌟', title: 'Consistency Champion', message: `${published} posts in ${days} days! Consistent posting grows audiences 3× faster.` });
  }

  if (groqClient && published >= 3) {
    try {
      const tip = await callGroq(
        'You are a social media growth expert for Nepal market. Give concise, specific, actionable advice.',
        `Performance last ${days} days: ${published} posts, ${failed} failed, ${avgEng} avg engagement, ${unread} unread messages.
Give ONE specific actionable tip (max 2 sentences) for a Nepali business to improve right now.`,
        { temperature: 0.7, maxTokens: 120 }
      );
      if (tip) insights.unshift({ type: 'ai', icon: '🤖', title: 'Groq AI Insight', message: tip });
    } catch { /* silent */ }
  }

  res.json({
    insights,
    summary: { total_posts: total, published, failed, avg_engagement: avgEng, unread_messages: unread, best_hashtag: topHashtag?.hashtag || null },
    groq_available: !!groqClient,
    groq_model: GROQ_MODEL,
  });
});

// ─── GET /api/ai/status ───────────────────────────────────────────────────────
router.get('/status', authenticate, async (req: Request, res: Response) => {
  let groq_ok = false;
  if (groqClient) {
    try {
      await groqClient.chat.completions.create({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      });
      groq_ok = true;
    } catch { groq_ok = false; }
  }
  res.json({
    groq_available: !!groqClient && groq_ok,
    groq_key_configured: !!groqClient,
    groq_ok,
    model: GROQ_MODEL,
    features: {
      generate: true, rewrite: !!groqClient, hashtags: true,
      reply_suggestion: true, translate: !!groqClient, caption: !!groqClient,
      auto_responder_suggestion: true, best_time: true, insights: true,
    },
  });
});

export default router;
