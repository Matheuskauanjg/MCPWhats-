import test from 'node:test';
import assert from 'node:assert/strict';
import { reviveStoredWhatsAppMessage, imageFileExtension } from '../src/whatsapp-image-utils.js';

test('revives persisted Buffer and Uint8Array media keys', () => {
  const stored = JSON.parse(JSON.stringify({
    key: { id: 'IMAGE1', remoteJid: '5511999999999@s.whatsapp.net', fromMe: true },
    message: {
      imageMessage: {
        mediaKey: { type: 'Buffer', data: [1, 2, 3] },
        fileSha256: { 0: 4, 1: 5, 2: 6 },
        fileEncSha256: [7, 8, 9],
        mimetype: 'image/jpeg'
      }
    }
  }));
  const result = reviveStoredWhatsAppMessage(stored);
  assert.deepEqual(result.message.imageMessage.mediaKey, Buffer.from([1, 2, 3]));
  assert.deepEqual(result.message.imageMessage.fileSha256, Buffer.from([4, 5, 6]));
  assert.deepEqual(result.message.imageMessage.fileEncSha256, Buffer.from([7, 8, 9]));
  assert.equal(result.key.id, 'IMAGE1');
});

test('rejects objects without message content and resolves safe extensions', () => {
  assert.equal(reviveStoredWhatsAppMessage({ key: { id: '1' } }), null);
  assert.equal(imageFileExtension('image/png'), 'png');
  assert.equal(imageFileExtension('image/webp'), 'webp');
  assert.equal(imageFileExtension('image/jpeg; quality=90'), 'jpg');
  assert.equal(imageFileExtension('invalid/type'), 'jpg');
});
