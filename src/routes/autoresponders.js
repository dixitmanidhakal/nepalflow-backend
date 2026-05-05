/**
 * Auto-Responder Bot Rules Routes
 * GET    /api/auto-responders        - list rules
 * POST   /api/auto-responders        - create rule
 * PUT    /api/auto-responders/:id    - update rule
 * DELETE /api/auto-responders/:id    - delete rule
 * PATCH  /api/auto-responders/:id/toggle - activate/pause
 * POST   /api/auto-responders/test   - test a message against all rules
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');

// GET /api/auto-responders
router.get('/', authenticate, (req, res) => {
  const rules = db.all(
    `SELECT ar.*, sa.account_name, sa.platform as account_platform
     FROM auto_responders ar
     LEFT JOIN social_accounts sa ON ar.account_id = sa.id
     WHERE ar.user_id = ? ORDER BY ar.created_at DESC`,
    [req.user.id]
  );
  res.json({ rules: rules.map(parseRule) });
});

// POST /api/auto-responders
router.post('/', authenticate, (req, res) => {
  const { name, trigger_type = 'keyword', keywords, response, platforms, account_id, match_type = 'any' } = req.body;
  if (!name?.trim())     return res.status(400).json({ error: 'Rule name is required' });
  if (!response?.trim()) return res.status(400).json({ error: 'Response message is required' });
  if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
    return res.status(400).json({ error: 'At least one keyword is required' });
  }
  const id = uuidv4();
  db.run(
    `INSERT INTO auto_responders (id, user_id, account_id, name, trigger_type, keywords, response, platforms, match_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, req.user.id, account_id || null, name.trim(), trigger_type,
     JSON.stringify(keywords.map(k => k.toLowerCase().trim())),
     response.trim(),
     JSON.stringify(platforms || ['facebook', 'instagram']),
     match_type]
  );
  const rule = db.get('SELECT * FROM auto_responders WHERE id = ?', [id]);
  res.status(201).json({ rule: parseRule(rule) });
});

// PUT /api/auto-responders/:id
router.put('/:id', authenticate, (req, res) => {
  const rule = db.get('SELECT id FROM auto_responders WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  const { name, keywords, response, platforms, account_id, match_type, trigger_type } = req.body;
  const updates = [];
  const params = [];
  if (name !== undefined)         { updates.push('name = ?');         params.push(name); }
  if (keywords !== undefined)     { updates.push('keywords = ?');     params.push(JSON.stringify(keywords.map(k => k.toLowerCase().trim()))); }
  if (response !== undefined)     { updates.push('response = ?');     params.push(response); }
  if (platforms !== undefined)    { updates.push('platforms = ?');    params.push(JSON.stringify(platforms)); }
  if (account_id !== undefined)   { updates.push('account_id = ?');   params.push(account_id || null); }
  if (match_type !== undefined)   { updates.push('match_type = ?');   params.push(match_type); }
  if (trigger_type !== undefined) { updates.push('trigger_type = ?'); params.push(trigger_type); }
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
  updates.push("updated_at = datetime('now')");
  params.push(req.params.id);
  db.run(`UPDATE auto_responders SET ${updates.join(', ')} WHERE id = ?`, params);
  const updated = db.get('SELECT * FROM auto_responders WHERE id = ?', [req.params.id]);
  res.json({ rule: parseRule(updated) });
});

// DELETE /api/auto-responders/:id
router.delete('/:id', authenticate, (req, res) => {
  const rule = db.get('SELECT id FROM auto_responders WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  db.run('DELETE FROM auto_responders WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// PATCH /api/auto-responders/:id/toggle
router.patch('/:id/toggle', authenticate, (req, res) => {
  const rule = db.get('SELECT * FROM auto_responders WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!rule) return res.status(404).json({ error: 'Rule not found' });
  const newState = rule.is_active ? 0 : 1;
  db.run('UPDATE auto_responders SET is_active = ? WHERE id = ?', [newState, rule.id]);
  res.json({ is_active: newState });
});

// POST /api/auto-responders/test — test a message against active rules
router.post('/test', authenticate, (req, res) => {
  const { message, platform = 'facebook' } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });
  const rules = db.all(
    "SELECT * FROM auto_responders WHERE user_id = ? AND is_active = 1",
    [req.user.id]
  );
  const matched = [];
  for (const rule of rules) {
    const keywords = tryParse(rule.keywords, []);
    const platforms = tryParse(rule.platforms, []);
    if (!platforms.includes(platform)) continue;
    const msgLower = message.toLowerCase();
    const matches = rule.match_type === 'all'
      ? keywords.every(k => msgLower.includes(k))
      : keywords.some(k => msgLower.includes(k));
    if (matches) matched.push({ rule: parseRule(rule), response: rule.response });
  }
  res.json({ matched, first_response: matched[0]?.response || null });
});

function parseRule(r) {
  return {
    ...r,
    keywords: tryParse(r.keywords, []),
    platforms: tryParse(r.platforms, ['facebook', 'instagram']),
  };
}
function tryParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = router;
