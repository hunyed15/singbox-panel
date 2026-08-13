import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deployMachine } from '../src/deploy.js';

function fakeSsh({ failOn = null } = {}) {
  const calls = [];
  const ssh = {
    calls,
    exec: async (conn, cmd) => {
      calls.push(cmd);
      if (failOn && cmd.includes(failOn)) throw new Error(`fail:${failOn}`);
      return { stdout: '', stderr: '' };
    },
    writeFile: async () => {
      calls.push('writeFile');
    },
  };
  return ssh;
}

const OPTS = {
  singboxBin: '/usr/local/bin/sing-box',
  singboxConfig: '/etc/sing-box/config.json',
  singboxUnit: 'sing-box',
};

test('successful deploy: check -> install -> reload', async () => {
  const ssh = fakeSsh();
  const res = await deployMachine(ssh, {}, { log: {} }, OPTS);
  assert.equal(res.ok, true);
  assert.ok(ssh.calls.some((c) => c.includes('sing-box check')));
  assert.ok(ssh.calls.some((c) => c.includes('install -m 600')));
  assert.ok(ssh.calls.some((c) => c.includes('systemctl reload sing-box')));
  assert.ok(Array.isArray(res.steps) && res.steps.length >= 5);
});

test('check failure aborts before install', async () => {
  const ssh = fakeSsh({ failOn: 'check' });
  const res = await deployMachine(ssh, {}, { log: {} }, OPTS);
  assert.equal(res.ok, false);
  assert.ok(!ssh.calls.some((c) => c.includes('install -m 600')));
});

test('reload failure: restore backup, reload again, rolledBack=true', async () => {
  const ssh = fakeSsh({ failOn: 'systemctl reload' });
  const res = await deployMachine(ssh, {}, { log: {} }, OPTS);
  assert.equal(res.ok, false);
  assert.equal(res.rolledBack, true);
  assert.ok(ssh.calls.some((c) => c.includes('.bak')));
  // 回滚后再次 reload(失败被吞)
  const reloads = ssh.calls.filter((c) => c.includes('systemctl reload sing-box'));
  assert.equal(reloads.length, 2);
});

test('mkdir + upload happen first', async () => {
  const ssh = fakeSsh();
  await deployMachine(ssh, {}, { log: {} }, OPTS);
  assert.equal(ssh.calls[0], 'mkdir -p /tmp/singbox-panel');
  assert.equal(ssh.calls[1], 'writeFile');
});
