import crypto from 'node:crypto';

const TAG_LEN = 16;

/** 任意长度 secret → 32 字节密钥(sha256;兼容 openssl rand -hex 32 的 64 字符输入) */
function deriveKey(secret) {
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

/** AES-256-GCM 加密,输出 `base64(iv).base64(tag|data)` */
export function encrypt(secret, plaintext) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${Buffer.concat([body, tag]).toString('base64')}`;
}

export function decrypt(secret, token) {
  const key = deriveKey(secret);
  const [ivB64, dataB64] = token.split('.');
  const iv = Buffer.from(ivB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const tag = data.subarray(data.length - TAG_LEN);
  const body = data.subarray(0, data.length - TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

export function genUuid() {
  return crypto.randomUUID();
}

/** ss-2022 密码:16 字节 base64 */
export function genSsPassword() {
  return crypto.randomBytes(16).toString('base64');
}

/** Reality short_id:16 位 hex */
export function genShortId() {
  return crypto.randomBytes(8).toString('hex');
}

/** x25519 密钥对,返回 JWK 的 x/d(base64url) */
export function genRealityKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const pub = publicKey.export({ format: 'jwk' });
  const priv = privateKey.export({ format: 'jwk' });
  return { publicKey: pub.x, privateKey: priv.d };
}

export function genRandomHex(bytes = 12) {
  return crypto.randomBytes(bytes).toString('hex');
}

export const cryptoModule = {
  encrypt,
  decrypt,
  genUuid,
  genSsPassword,
  genShortId,
  genRealityKeypair,
  genRandomHex,
};
