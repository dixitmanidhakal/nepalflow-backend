/**
 * JWT Authentication Middleware
 */

const jwt = require('jsonwebtoken');
const db = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'nepalflow_secret_dev';

/**
 * Generate a JWT for a user
 */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, language: user.language },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Verify JWT and attach user to request
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.status(401).json({ error: 'Unauthorized: User not found' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
}

/**
 * Verify user owns the social account being accessed
 */
function authorizeAccount(req, res, next) {
  const accountId = req.params.accountId || req.body.accountId;
  if (!accountId) return next();

  const account = db.prepare(
    'SELECT * FROM social_accounts WHERE id = ? AND user_id = ?'
  ).get(accountId, req.user.id);

  if (!account) {
    return res.status(403).json({ error: 'Forbidden: Account does not belong to you' });
  }

  req.socialAccount = account;
  next();
}

module.exports = { generateToken, authenticate, authorizeAccount };
