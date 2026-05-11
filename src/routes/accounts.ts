/**
 * Social Accounts Routes
 */
import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/database';
import { authenticate } from '../middleware/auth';
import * as facebookService from '../services/facebookService';
import { SocialAccount } from '../types';

const router = express.Router();

router.use(authenticate);

// GET /accounts
router.get('/', (req: Request, res: Response) => {
  const accounts = db.all<SocialAccount>(
    'SELECT id, platform, account_id, account_name, profile_pic, is_active, created_at FROM social_accounts WHERE user_id = ? ORDER BY created_at DESC',
    [req.user!.id]
  );
  res.json({ accounts });
});

// POST /accounts/facebook
router.post('/facebook', async (req: Request, res: Response) => {
  const { userAccessToken } = req.body as { userAccessToken: string };
  if (!userAccessToken) return res.status(400).json({ error: 'userAccessToken is required' });
  try {
    const pages = await facebookService.getUserPages(userAccessToken);
    const linked: Array<{ id: string; account_name: string; platform: string; updated: boolean }> = [];
    for (const page of pages) {
      const p = page as {
        id: string;
        name: string;
        access_token: string;
        picture?: { data?: { url?: string } };
        instagram_business_account?: { id: string };
      };

      let pageToken = p.access_token;
      try { pageToken = await facebookService.getLongLivedToken(p.access_token); } catch (_) {}

      const existing = db.get<{ id: string }>(
        "SELECT id FROM social_accounts WHERE user_id = ? AND platform = 'facebook' AND account_id = ?",
        [req.user!.id, p.id]
      );
      if (existing) {
        db.run('UPDATE social_accounts SET access_token = ?, is_active = 1 WHERE id = ?', [pageToken, existing.id]);
        linked.push({ id: existing.id, account_name: p.name, platform: 'facebook', updated: true });
      } else {
        const id = uuidv4();
        db.run(
          "INSERT INTO social_accounts (id, user_id, platform, account_id, account_name, access_token, profile_pic) VALUES (?, ?, 'facebook', ?, ?, ?, ?)",
          [id, req.user!.id, p.id, p.name, pageToken, p.picture?.data?.url || null]
        );
        linked.push({ id, account_name: p.name, platform: 'facebook', updated: false });
      }
      if (p.instagram_business_account) {
        const igId = p.instagram_business_account.id;
        const igName = p.name + ' (Instagram)';
        const igExisting = db.get<{ id: string }>(
          "SELECT id FROM social_accounts WHERE user_id = ? AND platform = 'instagram' AND account_id = ?",
          [req.user!.id, igId]
        );
        if (!igExisting) {
          const igSaId = uuidv4();
          db.run(
            "INSERT INTO social_accounts (id, user_id, platform, account_id, account_name, access_token) VALUES (?, ?, 'instagram', ?, ?, ?)",
            [igSaId, req.user!.id, igId, igName, pageToken]
          );
          linked.push({ id: igSaId, account_name: igName, platform: 'instagram', updated: false });
        }
      }
    }
    res.json({ linked, message: linked.length + ' account(s) connected' });
  } catch (error: unknown) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// DELETE /accounts/:id
router.delete('/:id', (req: Request, res: Response) => {
  const account = db.get('SELECT * FROM social_accounts WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  db.run('DELETE FROM social_accounts WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// PATCH /accounts/:id/toggle
router.patch('/:id/toggle', (req: Request, res: Response) => {
  const account = db.get<SocialAccount>('SELECT * FROM social_accounts WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  const newStatus = account.is_active ? 0 : 1;
  db.run('UPDATE social_accounts SET is_active = ? WHERE id = ?', [newStatus, req.params.id]);
  res.json({ success: true, is_active: newStatus });
});

export default router;
