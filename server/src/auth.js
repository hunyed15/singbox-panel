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
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    const token = signToken(jwtSecret, { username: row.username, sub: row.id });
    return res.json({ token, username: row.username });
  });

  router.get('/me', requireAuth(jwtSecret), (req, res) => {
    const row = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.sub);
    if (!row) return res.status(401).json({ error: 'unauthorized' });
    return res.json({ username: row.username });
  });

  // 在线修改管理员用户名/密码
  router.put('/account', requireAuth(jwtSecret), async (req, res) => {
    const { username, oldPassword, newPassword } = req.body || {};
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
    if (!row) return res.status(401).json({ error: 'unauthorized' });
    if (!(await verifyPassword(oldPassword || '', row.password_hash))) {
      // 旧密码错误是输入问题(400),不是会话失效(401),避免前端误判为登录过期
      return res.status(400).json({ error: '当前密码错误' });
    }
    let nextUsername = row.username;
    if (username !== undefined && String(username).trim() !== row.username) {
      const uname = String(username).trim();
      if (!uname) return res.status(400).json({ error: '用户名不能为空' });
      const dup = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(uname, row.id);
      if (dup) return res.status(409).json({ error: '用户名已存在' });
      nextUsername = uname;
    }
    if (newPassword !== undefined && String(newPassword) !== '') {
      const pw = String(newPassword);
      if (pw.length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(pw), row.id);
    }
    if (nextUsername !== row.username) {
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(nextUsername, row.id);
    }
    return res.json({ username: nextUsername });
  });

  return router;
}
