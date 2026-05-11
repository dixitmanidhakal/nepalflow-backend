/**
 * Passport.js OAuth Strategy Configuration
 */
import { Strategy as FacebookStrategy } from 'passport-facebook';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { v4 as uuidv4 } from 'uuid';
import { PassportStatic } from 'passport';
import db from '../db/database';
import { User } from '../types';

export default (passport: PassportStatic): void => {
  if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET && process.env.FACEBOOK_APP_ID !== 'your_facebook_app_id_here') {
    passport.use(new FacebookStrategy({
      clientID: process.env.FACEBOOK_APP_ID!,
      clientSecret: process.env.FACEBOOK_APP_SECRET!,
      callbackURL: process.env.FACEBOOK_CALLBACK_URL!,
      profileFields: ['id', 'emails', 'displayName', 'picture.type(large)'],
      graphAPIVersion: 'v19.0',
    }, (accessToken, refreshToken, profile, done) => {
      try {
        const email = (profile.emails && profile.emails[0]) ? profile.emails[0].value : ('fb_' + profile.id + '@nepalflow.local');
        let user = db.get<User>("SELECT * FROM users WHERE provider_id = ? AND provider = 'facebook'", [profile.id]);
        if (!user) {
          const id = uuidv4();
          const avatar = (profile.photos && profile.photos[0]) ? profile.photos[0].value : null;
          db.run('INSERT INTO users (id, email, name, avatar_url, provider, provider_id) VALUES (?, ?, ?, ?, ?, ?)',
            [id, email, profile.displayName, avatar, 'facebook', profile.id]);
          user = db.get<User>('SELECT * FROM users WHERE id = ?', [id]);
        }
        done(null, user as User);
      } catch (err) { done(err as Error); }
    }));
  }

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CLIENT_ID !== 'your_google_client_id_here') {
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: process.env.GOOGLE_CALLBACK_URL!,
    }, (accessToken, refreshToken, profile, done) => {
      try {
        const email = (profile.emails && profile.emails[0]) ? profile.emails[0].value : null;
        let user = db.get<User>('SELECT * FROM users WHERE email = ?', [email]);
        if (!user) {
          const id = uuidv4();
          const avatar = (profile.photos && profile.photos[0]) ? profile.photos[0].value : null;
          db.run('INSERT INTO users (id, email, name, avatar_url, provider, provider_id) VALUES (?, ?, ?, ?, ?, ?)',
            [id, email, profile.displayName, avatar, 'google', profile.id]);
          user = db.get<User>('SELECT * FROM users WHERE id = ?', [id]);
        }
        done(null, user as User);
      } catch (err) { done(err as Error); }
    }));
  }

  passport.serializeUser((user: Express.User, done) => done(null, (user as User).id));
  passport.deserializeUser((id: string, done) => {
    const user = db.get<User>('SELECT * FROM users WHERE id = ?', [id]);
    done(null, user || false);
  });
};
