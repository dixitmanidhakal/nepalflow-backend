/**
 * NepalFlow API Server - Entry Point
 * Social Media Automation Tool for Nepali SMBs
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const passport = require('passport');

const app = express();
const PORT = process.env.PORT || 5001;

// ─── Security & Middleware ────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting — more generous for AI routes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api', limiter);

// ─── Passport OAuth Setup ────────────────────────────────────────────────────
require('./config/passport')(passport);
app.use(passport.initialize());

// ─── Core Routes ─────────────────────────────────────────────────────────────
app.use('/auth',                   require('./routes/auth'));
app.use('/api/accounts',           require('./routes/accounts'));
app.use('/api/posts',              require('./routes/posts'));
app.use('/api/inbox',              require('./routes/inbox'));
app.use('/api/analytics',          require('./routes/analytics'));

// ─── New Feature Routes ───────────────────────────────────────────────────────
app.use('/api/templates',          require('./routes/templates'));
app.use('/api/auto-responders',    require('./routes/autoresponders'));
app.use('/api/notifications',      require('./routes/notifications'));
app.use('/api/rss',                require('./routes/rss'));
app.use('/api/ai',                 require('./routes/ai'));
app.use('/api/queue',              require('./routes/queue'));

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'NepalFlow API',
    version: '2.0.0',
    features: ['posts', 'inbox', 'analytics', 'templates', 'ai-generator', 'auto-responders', 'rss-feeds', 'bulk-queue', 'notifications'],
    timestamp: new Date().toISOString(),
  });
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.path} not found` });
});

// ─── Start Server & Scheduler ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 NepalFlow API v2.0 running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️  Database: ${process.env.DB_PATH || './db/nepalflow.sqlite'}`);
  console.log(`✨ Features: AI Generator, Templates, Auto-Responders, RSS, Bulk Queue\n`);

  const { startScheduler } = require('./services/schedulerService');
  startScheduler();
});

module.exports = app;
