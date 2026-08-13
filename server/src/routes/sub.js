import express from 'express';
import { getSetting } from '../db.js';
import { collectNodes, pickFormat, toBase64, toSingboxConfig } from '../sub.js';

export function makeSubRouter(db, appSecret) {
  const router = express.Router();

  router.get('/:slug', (req, res) => {
    if (getSetting(db, 'sub_slug') !== req.params.slug) {
      return res.status(404).json({ error: 'not found' });
    }
    const views = collectNodes(db, appSecret);
    const format = pickFormat(req.query, req.get('user-agent') || '');
    if (format === 'singbox') {
      return res.type('application/json').send(JSON.stringify(toSingboxConfig(views), null, 2));
    }
    return res.type('text/plain').send(toBase64(views));
  });

  return router;
}
