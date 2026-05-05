/**
 * Passport.js OAuth Strategy Configuration
 */
const FacebookStrategy = require('passport-facebook').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { v4: uuidv4 } = require('uuid');
const db = require('../db/database');

module.exports = (passport) => {
  if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET && process.env.FACEBOOK_APP_ID !== 'your_facebook_app_id_here') {
    passport.use(new FacebookStrategy({
      clientID: process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.FACEBOOK_APP_SECRET,
      callbackURL: process.env.FACEBOOK_CALLBACK_URL,
      profileFields: ['id', 'emails', 'displayName', 'picture.type(large)'],
    }, (accessToken, refreshToken, profile, done) => {
      try {
        const email = (profile.emails && profile.emails[0]) ? profile.emails[0].value : ('fb_' + profile.id + '@nepalflow.local');
        let user = db.get("SELECT * FROM users WHERE provider_id = ? AND provider = 'facebook'", [profile.id]);
        if (!user) {
          const id = uuidv4();
          const avatar = (profile.photos && profile.photos[0]) ? profile.photos[0].value : null;
          db.run('INSERT INTO users (id, email, name, avatar_url, provider, provider_id) VALUES (?, ?, ?, ?, ?, ?)',
            [id, email, profile.displayName, avatar, 'facebook', profile.id]);
          user = db.get('SELECT * FROM users WHERE id = ?', [id]);
        }
        done(null, user);
      } catch (err) { done(err); }
    }));
  }

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CLIENT_ID !== 'your_google_client_id_here') {
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    }, (accessToken, refreshToken, profile, done) => {
      try {
        const email = (profile.emails && profile.emails[0]) ? profile.emails[0].value : null;
        let user = db.get('SELECT * FROM users WHERE email = ?', [email]);
        if (!user) {
          const id = uuidv4();
          const avatar = (profile.photos && profile.photos[0]) ? profile.photos[0].value : null;
          db.run('INSERT INTO users (id, email, name, avatar_url, provider, provider_id) VALUES (?, ?, ?, ?, ?, ?)',
            [id, email, profile.displayName, avatar, 'google', profile.id]);
          user = db.get('SELECT * FROM users WHERE id = ?', [id]);
        }
        done(null, user);
      } catch (err) { done(err); }
    }));
  }

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser((id, done) => {
    const user = db.get('SELECT * FROM users WHERE id = ?', [id]);
    done(null, user || false);
  });
};
