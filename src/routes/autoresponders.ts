/**
 * Auto-Responder Bot Rules Routes
 */
import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { authenticate } from '../middleware/auth';
import { AutoResponder } from '../types';

const router = express.Router();

function tryParse<T>(str: string, fallback: T): T {
  try { return JSON.parse(str) as T; } catch { return fallback; }
}

function parseRule(r: AutoResponder): Omit<AutoResponder, 'keywords' | 'platforms'> & { keywords: string[]; platforms: string[] } {
  return {
    ...r,
    keywords: tryParse<string[]>(r.keywords, []),
    platforms: tryParse<string[]>(r.platforms, ['facebook', 'instagram']),
  };
}

// GET /api/auto-responders
router.get('/', authenticate, (req: Request, res: Response) => {
  const rules = db.all<AutoResponder>(
    `SELECT ar.*, sa.account_name, sa.platform as account_platform
     FROM auto_responders ar
     LEFT JOIN social_accounts sa ON ar.account_id = sa.id
     WHERE ar.user_id = ? ORDER BY ar.created_at DESC`,
    [req.user!.id]
  );
  res.json({ rules: rules.map(parseRule) });
});

// POST /api/auto-responders
router.post('/', authenticate, (req: Request, res: Response) => {
  const { name, trigger_type = 'keyword', keywords, response, platforms, account_id, match_type = 'any' } = req.body as {
    name?: string;
    trigger_type?: string;
    keywords?: string[];
    response?: string;
    platforms?: string[];
    account_id?: string;
    match_type?: string;
  };
  if (!name?.trim())     return res.status(400).json({ error: 'Rule name is required' });
  if (!response?.trim()) return res.status(400).json({ error: 'Response message is required' });
  if (trigger_type === 'keyword' && (!keywords || !Array.isArray(keywords) || keywords.length === 0)) {
    return res.status(400).json({ error: 'At least one keyword is required for keyword trigger' });
  }
  const id = uuidv4();
  db.run(
    `INSERT INTO auto_responders (id, user_id, account_id, name, trigger_type, keywords, response, platforms, match_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, req.user!.id, account_id || null, name.trim(), trigger_type,
     JSON.stringify(Array.isArray(keywords) ? keywords.map((k: string) => k.toLowerCase().trim()) : []),
     response.trim(),
     JSON.stringify(platforms || ['facebook', 'instagram']),
     match_type]
  );
  const rule = db.get<AutoResponder>('SELECT * FROM auto_responders WHERE id = ?', [id]);
  res.status(201).json({ rule: parseRule(rule!) });
});

// PUT /api/auto-responders/:id
router.put('/:id', authenticate, (req: Request, res: Response) => {
  const rule = db.get('SELECT id FROM auto_responders WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  const { name, keywords, response, platforms, account_id, match_type, trigger_type } = req.body as {
    name?: string;
    keywords?: string[];
    response?: string;
    platforms?: string[];
    account_id?: string | null;
    match_type?: string;
    trigger_type?: string;
  };
  const updates: string[] = [];
  const params: unknown[] = [];
  if (name !== undefined)         { updates.push('name = ?');         params.push(name); }
  if (keywords !== undefined)     { updates.push('keywords = ?');     params.push(JSON.stringify(keywords.map((k: string) => k.toLowerCase().trim()))); }
  if (response !== undefined)     { updates.push('response = ?');     params.push(response); }
  if (platforms !== undefined)    { updates.push('platforms = ?');    params.push(JSON.stringify(platforms)); }
  if (account_id !== undefined)   { updates.push('account_id = ?');   params.push(account_id || null); }
  if (match_type !== undefined)   { updates.push('match_type = ?');   params.push(match_type); }
  if (trigger_type !== undefined) { updates.push('trigger_type = ?'); params.push(trigger_type); }
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
  updates.push("updated_at = datetime('now')");
  params.push(req.params.id);
  db.run(`UPDATE auto_responders SET ${updates.join(', ')} WHERE id = ?`, params);
  const updated = db.get<AutoResponder>('SELECT * FROM auto_responders WHERE id = ?', [req.params.id]);
  res.json({ rule: parseRule(updated!) });
});

// DELETE /api/auto-responders/:id
router.delete('/:id', authenticate, (req: Request, res: Response) => {
  const rule = db.get('SELECT id FROM auto_responders WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  db.run('DELETE FROM auto_responders WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// PATCH /api/auto-responders/:id/toggle
router.patch('/:id/toggle', authenticate, (req: Request, res: Response) => {
  const rule = db.get<AutoResponder>('SELECT * FROM auto_responders WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  const newState = rule.is_active ? 0 : 1;
  db.run('UPDATE auto_responders SET is_active = ? WHERE id = ?', [newState, rule.id]);
  res.json({ is_active: newState });
});

// POST /api/auto-responders/test
router.post('/test', authenticate, (req: Request, res: Response) => {
  const { message, platform = 'facebook' } = req.body as { message?: string; platform?: string };
  if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });
  const rules = db.all<AutoResponder>(
    "SELECT * FROM auto_responders WHERE user_id = ? AND is_active = 1",
    [req.user!.id]
  );
  const matched: Array<{ rule: ReturnType<typeof parseRule>; response: string }> = [];
  for (const rule of rules) {
    const keywords = tryParse<string[]>(rule.keywords, []);
    const platforms = tryParse<string[]>(rule.platforms, []);
    if (!platforms.includes(platform)) continue;
    const msgLower = message.toLowerCase();
    const matches = rule.match_type === 'all'
      ? keywords.every((k: string) => msgLower.includes(k))
      : keywords.some((k: string) => msgLower.includes(k));
    if (matches) matched.push({ rule: parseRule(rule), response: rule.response });
  }
  res.json({ matched, first_response: matched[0]?.response || null });
});

export default router;
