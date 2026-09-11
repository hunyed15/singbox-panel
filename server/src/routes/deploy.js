import express from 'express';
import { deployServer } from '../deployServices.js';
import { deployXrayServer } from '../deployXrayServices.js';
import { buildConn } from '../ssh.js';
import { ApiError } from '../errors.js';

export function makeDeployRouter({ db, ssh, crypto, config }) {
  const router = express.Router();

  /** 一键部署全部:遍历所有 SSH 机器,部署 sing-box + xray 配置 */
  router.post('/all', async (req, res) => {
    const servers = db.prepare("SELECT * FROM servers WHERE control='ssh'").all();
    const results = [];

    for (const row of servers) {
      const sid = row.id;
      let singbox = null;
      let xray = null;

      // 部署 sing-box
      try {
        const sbHas = db.prepare('SELECT COUNT(*) c FROM nodes WHERE server_id = ? AND enabled = 1').get(sid).c;
        if (sbHas > 0) {
          singbox = await deployServer(db, ssh, crypto, config, sid);
        } else {
          singbox = { ok: true, steps: ['skip'] };
        }
      } catch (err) {
        singbox = { ok: false, error: err.message };
      }

      // 部署 xray
      try {
        const xrHas = db.prepare('SELECT COUNT(*) c FROM xray_nodes WHERE server_id = ? AND enabled = 1').get(sid).c;
        const isLanding = db.prepare("SELECT COUNT(*) c FROM xray_nodes WHERE landing_server_id = ? AND enabled = 1 AND outbound_type = 'relay'").get(sid).c;
        if (xrHas > 0 || isLanding > 0) {
          xray = await deployXrayServer(db, ssh, crypto, config, sid);
        } else {
          xray = { ok: true, steps: ['skip'] };
        }
      } catch (err) {
        xray = { ok: false, error: err.message };
      }

      results.push({ serverId: sid, serverName: row.name, singbox, xray });
    }

    res.json({ results });
  });

  return router;
}