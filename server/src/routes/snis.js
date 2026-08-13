import express from 'express';
import { ApiError } from '../errors.js';

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export function makeSnisRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    res.json(db.prepare('SELECT * FROM sni_library ORDER BY id').all());
  });

  router.post('/', (req, res) => {
    const { domain, note = '' } = req.body || {};
    const d = String(domain || '').trim();
    if (!DOMAIN_RE.test(d)) throw new ApiError(400, '域名格式不正确,如 www.example.com');
    const dup = db.prepare('SELECT id FROM sni_library WHERE domain = ?').get(d);
    if (dup) throw new ApiError(409, '该域名已存在');
    const info = db
      .prepare('INSERT INTO sni_library (domain, note, builtin) VALUES (?,?,0)')
      .run(d, String(note).trim());
    res.json(db.prepare('SELECT * FROM sni_library WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT * FROM sni_library WHERE id = ?').get(id);
    if (!row) throw new ApiError(404, '域名不存在');
    const b = req.body || {};
    const domain = b.domain !== undefined ? String(b.domain).trim() : row.domain;
    if (!DOMAIN_RE.test(domain)) throw new ApiError(400, '域名格式不正确');
    const dup = db.prepare('SELECT id FROM sni_library WHERE domain = ? AND id != ?').get(domain, id);
    if (dup) throw new ApiError(409, '该域名已存在');
    db.prepare('UPDATE sni_library SET domain=?, note=? WHERE id=?').run(
      domain,
      b.note !== undefined ? String(b.note).trim() : row.note,
      id,
    );
    res.json(db.prepare('SELECT * FROM sni_library WHERE id = ?').get(id));
  });

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    const info = db.prepare('DELETE FROM sni_library WHERE id = ?').run(id);
    if (info.changes === 0) throw new ApiError(404, '域名不存在');
    res.json({ ok: true });
  });

  return router;
}
