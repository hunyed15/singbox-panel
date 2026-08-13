import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import express from 'express';

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export function signToken(jwtSecret, payload) {
  return jwt.sign(payload, jwtSecret, { expiresIn: '7d' });
}

export function requireAuth(jwtSecret) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'unauthorized' });
    try {
      req.user = jwt.verify(token, jwtSecret);
      return next();
    } catch {
      return res.status(401).json({ error: 'unauthorized' });
    }
  };
}

export function makeAuthRouter(db, jwtSecret) {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    const { username, password } = req.body || {};
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
    if (!row || !(await verifyPassword(password || '', row.password_hash))) {
      return res.status(401).json({ error: 'invalid credentials' });
    }
    const token = signToken(jwtSecret, { username: row.username, sub: row.id });
    return res.json({ token, username: row.username });
  });

  router.get('/me', requireAuth(jwtSecret), (req, res) => {
    return res.json({ username: req.user.username });
  });

  return router;
}
