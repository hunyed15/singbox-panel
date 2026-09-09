import express from 'express';
import { getSetting } from '../db.js';
import { collectXrayNodes, toXrayBase64 } from '../xray_sub.js';

export function makeXraySubRouter(db, appSecret) {
  const router = express.Router();

  router.get('/:slug', (req, res) => {
    if (getSetting(db, 'sub_slug') !== req.params.slug) {
      return res.status(404).json({ error: 'not found' });
    }
    const views = collectXrayNodes(db, appSecret);
    return res.type('text/plain').send(toXrayBase64(views));
  });

  return router;
}