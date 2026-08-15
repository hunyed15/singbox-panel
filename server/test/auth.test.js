import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { initDb, ensureAdmin } from '../src/db.js';
import { hashPassword, verifyPassword, signToken, requireAuth, makeAuthRouter } from '../src/auth.js';

test('bcrypt hash/verify', async () => {
  const hash = await hashPassword('sekrit');
  assert.notEqual(hash, 'sekrit');
  assert.equal(await verifyPassword('sekrit', hash), true);
  assert.equal(await verifyPassword('nope', hash), false);
});

test('signToken/requireAuth happy path', async () => {
  const token = signToken('jwt-secret', { username: 'admin' });
  const req = { headers: { authorization: `Bearer ${token}` } };
  let nexted = false;
  requireAuth('jwt-secret')(req, {}, () => {
    nexted = true;
  });
  assert.equal(nexted, true);
  assert.equal(req.user.username, 'admin');
});

test('requireAuth rejects missing/bad token with 401', async () => {
  const auth = requireAuth('jwt-secret');
  for (const headers of [{}, { authorization: 'Bearer bad.token.here' }]) {
    const res = {};
    res.status = (code) => {
      res.code = code;
      return res;
    };
    res.json = (body) => {
      res.body = body;
    };
    auth({ headers }, res, () => {
      throw new Error('should not next');
    });
    assert.equal(res.code, 401);
    assert.ok(res.body.error);
  }
});

test('auth router: login ok / bad creds 401 / me / account change', async () => {
  const db = initDb(':memory:');
  ensureAdmin(db, { username: 'admin', passwordHash: await hashPassword('pw123') });
  const app = express();
  app.use(express.json());
  app.use('/api/auth', makeAuthRouter(db, 'jwt-secret'));

  const bad = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'no' });
  assert.equal(bad.status, 401);

  const ok = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pw123' });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  assert.equal(ok.body.username, 'admin');
  const token = ok.body.token;

  const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  assert.equal(me.status, 200);
  assert.deepEqual(me.body, { username: 'admin' });

  // 旧密码错误 → 400(输入问题,非会话过期)
  const badPw = await request(app)
    .put('/api/auth/account')
    .set('Authorization', `Bearer ${token}`)
    .send({ oldPassword: 'wrong' });
  assert.equal(badPw.status, 400);
  assert.equal(badPw.body.error, '当前密码错误');

  // 改密码
  const chPw = await request(app)
    .put('/api/auth/account')
    .set('Authorization', `Bearer ${token}`)
    .send({ oldPassword: 'pw123', newPassword: 'pw456789' });
  assert.equal(chPw.status, 200);
  // 旧密码失效
  assert.equal((await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pw123' })).status, 401);
  // 新密码可登录
  const re = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'pw456789' });
  assert.equal(re.status, 200);

  // 改用户名
  const chU = await request(app)
    .put('/api/auth/account')
    .set('Authorization', `Bearer ${re.body.token}`)
    .send({ oldPassword: 'pw456789', username: 'boss' });
  assert.equal(chU.status, 200);
  assert.equal(chU.body.username, 'boss');
  // 新用户名登录 + /me 返回新名
  const re2 = await request(app).post('/api/auth/login').send({ username: 'boss', password: 'pw456789' });
  assert.equal(re2.status, 200);
  const me2 = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${re2.body.token}`);
  assert.deepEqual(me2.body, { username: 'boss' });

  // 新密码至少 6 位
  const short = await request(app)
    .put('/api/auth/account')
    .set('Authorization', `Bearer ${re2.body.token}`)
    .send({ oldPassword: 'pw456789', newPassword: '123' });
  assert.equal(short.status, 400);
});
