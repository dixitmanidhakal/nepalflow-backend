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
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Security & Middleware ────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api', limiter);

// ─── Passport OAuth Setup ────────────────────────────────────────────────────
require('./config/passport')(passport);
app.use(passport.initialize());

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/auth',         require('./routes/auth'));
app.use('/api/accounts', require('./routes/accounts'));
app.use('/api/posts',    require('./routes/posts'));
app.use('/api/inbox',    require('./routes/inbox'));
app.use('/api/analytics',require('./routes/analytics'));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'NepalFlow API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.path} not found` });
});

// ─── Start Server & Scheduler ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 NepalFlow API running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️  Database: ${process.env.DB_PATH || './db/nepalflow.sqlite'}\n`);

  // Start the post scheduler
  const { startScheduler } = require('./services/schedulerService');
  startScheduler();
});

module.exports = app; // for tests
