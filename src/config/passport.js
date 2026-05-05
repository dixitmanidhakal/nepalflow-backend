/**
 * Passport.js OAuth Strategy Configuration
 */

const FacebookStrategy = require('passport-facebook').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

module.exports = (passport) => {
  // ─── Facebook Strategy ──────────────────────────────────────────────────
  if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
    passport.use(new FacebookStrategy({
      clientID: process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.FACEBOOK_APP_SECRET,
      callbackURL: process.env.FACEBOOK_CALLBACK_URL,
      profileFields: ['id', 'emails', 'displayName', 'picture.type(large)'],
    }, (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value || `fb_${profile.id}@nepalflow.local`;
        let user = db.prepare('SELECT * FROM users WHERE provider_id = ? AND provider = ?')
          .get(profile.id, 'facebook');

        if (!user) {
          const id = uuidv4();
          db.prepare(`
            INSERT INTO users (id, email, name, avatar_url, provider, provider_id)
            VALUES (?, ?, ?, ?, 'facebook', ?)
          `).run(id, email, profile.displayName, profile.photos?.[0]?.value, profile.id);
          user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        }
        done(null, user);
      } catch (err) {
        done(err);
      }
    }));
  }

  // ─── Google Strategy ────────────────────────────────────────────────────
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    }, (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

        if (!user) {
          const id = uuidv4();
          db.prepare(`
            INSERT INTO users (id, email, name, avatar_url, provider, provider_id)
            VALUES (?, ?, ?, ?, 'google', ?)
          `).run(id, email, profile.displayName, profile.photos?.[0]?.value, profile.id);
          user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        }
        done(null, user);
      } catch (err) {
        done(err);
      }
    }));
  }

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    done(null, user || false);
  });
};
