import crypto from 'node:crypto';

const TEN_YEARS = 10 * 365 * 24 * 3600_000;

/* ---------- 最小 DER 编码器 ---------- */
function derLen(n) {
  if (n < 0x80) return [n];
  const bytes = [];
  let v = n;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

function der(tag, content) {
  return [tag, ...derLen(content.length), ...content];
}

function derSeq(...parts) {
  return der(0x30, parts.flat());
}

function derInt(bytes) {
  let b = [...bytes];
  if (b[0] & 0x80) b = [0x00, ...b];
  return der(0x02, b);
}

function derOid(oid) {
  const first = oid[0] * 40 + oid[1];
  const body = [];
  for (const comp of oid.slice(2)) {
    let v = comp;
    const part = [v & 0x7f];
    v >>= 7;
    while (v > 0) {
      part.unshift((v & 0x7f) | 0x80);
      v >>= 7;
    }
    body.push(...part);
  }
  return der(0x06, [first, ...body]);
}

function derBitString(content) {
  return der(0x03, [0x00, ...content]);
}

function derOctetString(bytes) {
  return der(0x04, bytes);
}

function derPrintable(str) {
  return der(0x13, Buffer.from(str, 'ascii'));
}

function derUtcTime(date) {
  const s = date.toISOString();
  const y = s.slice(2, 4);
  const rest = s.slice(5, 19).replace(/[:T-]/g, '');
  return der(0x17, Buffer.from(`${y}${rest}Z`, 'ascii'));
}

function derName(cn) {
  const attr = derSeq(derOid([2, 5, 4, 3]), derUtf8(cn));
  return derSeq(der(0x31, attr));
}

function derUtf8(str) {
  return der(0x0c, Buffer.from(str, 'utf8'));
}

/* OID 常量 */
const OID_EC_PUBLIC_KEY = derOid([1, 2, 840, 10045, 2, 1]);
const OID_PRIME256V1 = derOid([1, 2, 840, 10045, 3, 1, 7]);
const OID_ECDSA_SHA256 = derOid([1, 2, 840, 10045, 4, 3, 2]);

/**
 * 生成自签证书(ECDSA P-256,SAN 含 hostname 与 IP,10 年),纯 node:crypto 手构 DER。
 * 返回 PEM。每台机器生成一次,config 引用 certificate_path/key_path。
 */
export function genSelfSignedCert({ commonName, altNames = [] }) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });

  // EC 公钥点(未压缩 0x04 || x || y)
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');
  const point = Buffer.concat([Buffer.from([0x04]), x, y]);

  const algId = derSeq(OID_EC_PUBLIC_KEY, OID_PRIME256V1);
  const spki = derSeq(algId, derBitString(point));

  const notBefore = new Date(Date.now() - 3600_000);
  const notAfter = new Date(Date.now() + TEN_YEARS);
  const serial = crypto.randomBytes(16);

  // subjectAltName: DNS / IP
  const sanParts = [];
  for (const name of altNames) {
    const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(name) || name.includes(':');
    if (isIp) {
      const ip = name.includes(':')
        ? Buffer.from(name.split(':').map((h) => parseInt(h, 16)))
        : Buffer.from(name.split('.').map(Number));
      sanParts.push(der(0x87, ip)); // [7] iPAddress
    } else {
      sanParts.push(der(0x82, Buffer.from(name, 'utf8'))); // [2] dNSName
    }
  }
  // [3] extensions: SEQUENCE OF Extension
  const sanExtValue = derSeq(...sanParts);
  const basicExtValue = der(0x30, der(0x01, [0x00])); // basicConstraints cA=false → SEQ{ BOOLEAN FALSE }
  const extensions = der(
    0xa3,
    derSeq(
      derSeq(derOid([2, 5, 29, 19]), der(0x01, [0x01]), derOctetString(basicExtValue)), // basicConstraints critical
      derSeq(derOid([2, 5, 29, 17]), der(0x01, [0x00]), derOctetString(sanExtValue)), // SAN non-critical
    ),
  );

  const tbs = derSeq(
    der(0xa0, derInt([0x02])), // version v3
    derInt(serial),
    derSeq(OID_ECDSA_SHA256),
    derName(commonName),
    derSeq(derUtcTime(notBefore), derUtcTime(notAfter)),
    derName(commonName),
    spki,
    extensions,
  );

  const signer = crypto.createSign('sha256');
  signer.update(Buffer.from(tbs));
  const signature = signer.sign(privateKey);

  const certDer = derSeq(tbs, derSeq(OID_ECDSA_SHA256), derBitString(signature));

  const certPem = [
    '-----BEGIN CERTIFICATE-----',
    Buffer.from(certDer).toString('base64').match(/.{1,64}/g).join('\n'),
    '-----END CERTIFICATE-----',
    '',
  ].join('\n');
  const keyPem = privateKey.export({ type: 'sec1', format: 'pem' });

  return { certPem, keyPem };
}
