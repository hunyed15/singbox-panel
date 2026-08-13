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

test('auth router: login ok / bad creds 401 / me', async () => {
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

  const me = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${ok.body.token}`);
  assert.equal(me.status, 200);
  assert.deepEqual(me.body, { username: 'admin' });
});
