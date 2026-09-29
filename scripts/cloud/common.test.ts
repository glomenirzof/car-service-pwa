import {generateVapidKeys, vapidPublicFromPrivate} from './common.ts';

describe('VAPID keys for Web Push', () => {
  it('are a P-256 pair in the format push services expect', () => {
    const {publicKey, privateKey} = generateVapidKeys();
    const pub = Buffer.from(publicKey, 'base64url');
    expect(pub).toHaveLength(65);
    expect(pub[0]).toBe(4);
    expect(Buffer.from(privateKey, 'base64url')).toHaveLength(32);
    expect(publicKey).not.toMatch(/[=+/]/);
    expect(vapidPublicFromPrivate(privateKey)).toBe(publicKey);
  });
  it('differ on every call', () => {
    expect(generateVapidKeys().privateKey).not.toBe(generateVapidKeys().privateKey);
  });
});
