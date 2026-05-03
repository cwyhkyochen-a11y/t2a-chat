const crypto = require('crypto');
const ENC_KEY = process.env.IMAGINE_ENC_KEY || 'imagine-dev-key-32bytes-padding!'; // 32 bytes
const ALGO = 'aes-256-gcm';

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, Buffer.from(ENC_KEY, 'utf8').slice(0, 32), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + tag + ':' + encrypted;
}

function decrypt(cipherText) {
  try {
    const [ivHex, tagHex, encrypted] = cipherText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGO, Buffer.from(ENC_KEY, 'utf8').slice(0, 32), iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[crypto] decrypt failed:', err.message);
    return null;
  }
}

function maskKey(key) {
  if (!key || key.length < 8) return '***';
  return key.slice(0, 5) + '***' + key.slice(-4);
}

module.exports = { encrypt, decrypt, maskKey };
