/**
 * NepalFlow API Server - Entry Point
 * Social Media Automation Tool for Nepali SMBs
 */

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import passport from 'passport';

import configurePassport from './config/passport';
import authRouter from './routes/auth';
import accountsRouter from './routes/accounts';
import postsRouter from './routes/posts';
import inboxRouter from './routes/inbox';
import analyticsRouter from './routes/analytics';
import templatesRouter from './routes/templates';
import autorespondersRouter from './routes/autoresponders';
import notificationsRouter from './routes/notifications';
import rssRouter from './routes/rss';
import aiRouter from './routes/ai';
import queueRouter from './routes/queue';

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
configurePassport(passport);
app.use(passport.initialize());

// ─── Core Routes ─────────────────────────────────────────────────────────────
app.use('/auth',                   authRouter);
app.use('/api/accounts',           accountsRouter);
app.use('/api/posts',              postsRouter);
app.use('/api/inbox',              inboxRouter);
app.use('/api/analytics',          analyticsRouter);

// ─── New Feature Routes ───────────────────────────────────────────────────────
app.use('/api/templates',          templatesRouter);
app.use('/api/auto-responders',    autorespondersRouter);
app.use('/api/notifications',      notificationsRouter);
app.use('/api/rss',                rssRouter);
app.use('/api/ai',                 aiRouter);
app.use('/api/queue',              queueRouter);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'NepalFlow API',
    version: '2.0.0',
    features: ['posts', 'inbox', 'analytics', 'templates', 'ai-generator', 'auto-responders', 'rss-feeds', 'bulk-queue', 'notifications'],
    timestamp: new Date().toISOString(),
  });
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: `Route ${req.path} not found` });
});

// ─── Prevent silent crashes ───────────────────────────────────────────────────
process.on('uncaughtException', (err: Error) => {
  console.error('Uncaught Exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason: unknown) => {
  console.error('Unhandled Rejection:', reason);
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

export default app;
