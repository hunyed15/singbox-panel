import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import {
  encrypt,
  decrypt,
  genUuid,
  genSsPassword,
  genShortId,
  genRealityKeypair,
  genRandomHex,
} from '../src/crypto.js';
import { genSelfSignedCert } from '../src/sbconfig/cert.js';

const SECRET = 'k'.repeat(32);

test('encrypt/decrypt round-trip', () => {
  const tok = encrypt(SECRET, 'hello world');
  assert.notEqual(tok, 'hello world');
  assert.equal(decrypt(SECRET, tok), 'hello world');
});

test('decrypt with wrong key throws', () => {
  const tok = encrypt('a'.repeat(32), 'data');
  assert.throws(() => decrypt('b'.repeat(32), tok));
});

test('decrypt tampered data throws', () => {
  const tok = encrypt(SECRET, 'data');
  const [iv, data] = tok.split('.');
  const flipped = `${iv}.${data.slice(0, -1)}${data.endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => decrypt(SECRET, flipped));
});

test('genUuid returns v4 uuid', () => {
  const u = genUuid();
  assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('genSsPassword decodes to 16 bytes', () => {
  const p = genSsPassword();
  assert.equal(Buffer.from(p, 'base64').length, 16);
});

test('genShortId is 16 hex chars', () => {
  assert.match(genShortId(), /^[0-9a-f]{16}$/);
});

test('x25519 keypair keys are 43-char base64url', () => {
  const { publicKey, privateKey } = genRealityKeypair();
  assert.match(publicKey, /^[A-Za-z0-9_-]{43}$/);
  assert.match(privateKey, /^[A-Za-z0-9_-]{43}$/);
});

test('genRandomHex returns byteCount*2 hex', () => {
  assert.equal(genRandomHex(12).length, 24);
});

test('self-signed cert: parseable, SAN ok, ~10y validity, ECDSA P-256', () => {
  const { certPem, keyPem } = genSelfSignedCert({
    commonName: 'hk1',
    altNames: ['hk1', '203.0.113.11'],
  });
  assert.ok(certPem.includes('BEGIN CERTIFICATE'));
  assert.ok(keyPem.includes('BEGIN EC PRIVATE KEY'));

  const cert = new X509Certificate(certPem);
  assert.ok(cert.subject.includes('CN=hk1'));
  // SAN: hostname + IP
  const san = cert.subjectAltName || '';
  assert.ok(san.includes('hk1'));
  assert.ok(san.includes('203.0.113.11'));

  const days = (new Date(cert.validTo).getTime() - new Date(cert.validFrom).getTime()) / 86400000;
  assert.ok(days > 3650 - 5 && days < 3655, `validity days=${days}`);

  const key = new X509Certificate(certPem).publicKey;
  assert.equal(key.asymmetricKeyType, 'ec');
  assert.equal(key.asymmetricKeyDetails?.namedCurve, 'prime256v1');

  // 自签证书:用自己的公钥可验签名
  assert.ok(cert.verify(key));
});
