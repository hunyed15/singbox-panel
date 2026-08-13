import express from 'express';
import { ApiError } from '../errors.js';
import { getSetting, setSetting } from '../db.js';
import { genRandomHex } from '../crypto.js';

export function makeSettingsRouter(db, appSecret) {
  const router = express.Router();

  router.get('/', (req, res) => {
    let slug = getSetting(db, 'sub_slug');
    if (!slug) {
      slug = genRandomHex(6);
      setSetting(db, 'sub_slug', slug);
    }
    res.json({ subSlug: slug, subUrl: `/sub/${slug}` });
  });

  router.post('/', (req, res) => {
    const raw = String((req.body || {}).subSlug || '');
    if (!/^[a-zA-Z0-9_-]+$/.test(raw)) {
      throw new ApiError(400, 'slug 仅允许字母/数字/下划线/连字符');
    }
    setSetting(db, 'sub_slug', raw);
    res.json({ subSlug: raw, subUrl: `/sub/${raw}` });
  });

  return router;
}
