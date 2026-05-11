/**
 * JWT Authentication Middleware
 */

import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import db from '../db/database';
import { User } from '../types';

const JWT_SECRET: string = process.env.JWT_SECRET || 'nepalflow_secret_dev';

/**
 * Generate a JWT for a user
 */
export function generateToken(user: User): string {
  return jwt.sign(
    { id: user.id, email: user.email, language: user.language },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Verify JWT and attach user to request
 */
export function verifyToken(token: string): { id: string; email: string; language: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { id: string; email: string; language: string };
  } catch {
    return null;
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: No token provided' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string };
    const user = db.get<User>('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized: User not found' });
      return;
    }
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
}

/**
 * Verify user owns the social account being accessed
 */
export function authorizeAccount(req: Request, res: Response, next: NextFunction): void {
  const accountId = req.params.accountId || req.body.accountId;
  if (!accountId) { next(); return; }

  const account = db.get(
    'SELECT * FROM social_accounts WHERE id = ? AND user_id = ?',
    [accountId, req.user!.id]
  );

  if (!account) {
    res.status(403).json({ error: 'Forbidden: Account does not belong to you' });
    return;
  }

  req.socialAccount = account as unknown as import('../types').SocialAccount;
  next();
}
