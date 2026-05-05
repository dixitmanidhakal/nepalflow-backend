/**
 * Content Templates Routes
 * GET    /api/templates         - list templates
 * POST   /api/templates         - create template
 * GET    /api/templates/:id     - get one
 * PUT    /api/templates/:id     - update
 * DELETE /api/templates/:id     - delete
 * POST   /api/templates/:id/use - record usage, returns content
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');
const { authenticate } = require('../middleware/auth');

const CATEGORIES = ['general', 'promotion', 'product', 'event', 'festival', 'announcement', 'tip', 'quote', 'story'];

// GET /api/templates
router.get('/', authenticate, (req, res) => {
  const { category, search, platform } = req.query;
  let sql = 'SELECT * FROM templates WHERE user_id = ?';
  const params = [req.user.id];
  if (category && CATEGORIES.includes(category)) {
    sql += ' AND category = ?'; params.push(category);
  }
  if (search) {
    sql += ' AND (name LIKE ? OR content LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (platform) {
    sql += ' AND (platforms LIKE ? OR platforms LIKE ?)';
    params.push(`%"${platform}"%`, `%${platform}%`);
  }
  sql += ' ORDER BY use_count DESC, updated_at DESC';
  const templates = db.all(sql, params);
  res.json({ templates: templates.map(parseTemplate), categories: CATEGORIES });
});

// POST /api/templates
router.post('/', authenticate, (req, res) => {
  const { name, description = '', content, platforms = ['facebook', 'instagram'], hashtags = [], category = 'general' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Template name is required' });
  if (!content?.trim()) return res.status(400).json({ error: 'Template content is required' });
  const id = uuidv4();
  db.run(
    'INSERT INTO templates (id, user_id, name, description, content, platforms, hashtags, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, req.user.id, name.trim(), description, content.trim(), JSON.stringify(platforms), JSON.stringify(hashtags), category]
  );
  const template = db.get('SELECT * FROM templates WHERE id = ?', [id]);
  res.status(201).json({ template: parseTemplate(template) });
});

// GET /api/templates/:id
router.get('/:id', authenticate, (req, res) => {
  const template = db.get('SELECT * FROM templates WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!template) return res.status(404).json({ error: 'Template not found' });
  res.json({ template: parseTemplate(template) });
});

// PUT /api/templates/:id
router.put('/:id', authenticate, (req, res) => {
  const { name, description, content, platforms, hashtags, category } = req.body;
  const template = db.get('SELECT * FROM templates WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!template) return res.status(404).json({ error: 'Template not found' });

  const updates = [];
  const params = [];
  if (name !== undefined)        { updates.push('name = ?');        params.push(name); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (content !== undefined)     { updates.push('content = ?');     params.push(content); }
  if (platforms !== undefined)   { updates.push('platforms = ?');   params.push(JSON.stringify(platforms)); }
  if (hashtags !== undefined)    { updates.push('hashtags = ?');    params.push(JSON.stringify(hashtags)); }
  if (category !== undefined)    { updates.push('category = ?');    params.push(category); }
  if (updates.length === 0)      return res.status(400).json({ error: 'No fields to update' });

  updates.push("updated_at = datetime('now')");
  params.push(req.params.id);
  db.run(`UPDATE templates SET ${updates.join(', ')} WHERE id = ?`, params);
  const updated = db.get('SELECT * FROM templates WHERE id = ?', [req.params.id]);
  res.json({ template: parseTemplate(updated) });
});

// DELETE /api/templates/:id
router.delete('/:id', authenticate, (req, res) => {
  const template = db.get('SELECT id FROM templates WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!template) return res.status(404).json({ error: 'Template not found' });
  db.run('DELETE FROM templates WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// POST /api/templates/:id/use — record usage + return rendered content
router.post('/:id/use', authenticate, (req, res) => {
  const template = db.get('SELECT * FROM templates WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!template) return res.status(404).json({ error: 'Template not found' });
  const { variables = {} } = req.body;

  // Render {{variable}} placeholders
  let rendered = template.content;
  for (const [key, val] of Object.entries(variables)) {
    rendered = rendered.replace(new RegExp(`{{${key}}}`, 'g'), val);
  }

  db.run('UPDATE templates SET use_count = use_count + 1 WHERE id = ?', [template.id]);
  res.json({
    content: rendered,
    hashtags: JSON.parse(template.hashtags || '[]'),
    platforms: JSON.parse(template.platforms || '[]'),
  });
});

function parseTemplate(t) {
  return {
    ...t,
    platforms: tryParse(t.platforms, ['facebook', 'instagram']),
    hashtags: tryParse(t.hashtags, []),
  };
}

function tryParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = router;
