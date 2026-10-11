const BINARY_MEDIA_FIELDS = new Set([
  'mediaKey', 'fileSha256', 'fileEncSha256', 'jpegThumbnail',
  'thumbnail', 'firstScanSidecar', 'scansSidecar'
]);

function restoreBytes(value, fieldName = '') {
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return value;

  // Buffer's JSON representation is { type: 'Buffer', data: [...] }.
  if (value.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }

  if (BINARY_MEDIA_FIELDS.has(fieldName)) {
    if (Array.isArray(value) && value.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
      return Buffer.from(value);
    }
    // Uint8Array's JSON representation uses numeric keys.
    if (!Array.isArray(value)) {
      const keys = Object.keys(value);
      if (keys.length && keys.every((key, index) => key === String(index))) {
        return Buffer.from(keys.map(key => value[key]));
      }
    }
  }

  if (Array.isArray(value)) return value.map(item => restoreBytes(item));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, restoreBytes(item, key)])
  );
}

export function reviveStoredWhatsAppMessage(raw) {
  if (!raw || typeof raw !== 'object' || !raw.key || !raw.message) return null;
  return restoreBytes(raw);
}

export function imageFileExtension(mimetype) {
  const type = String(mimetype || '').split(';')[0].toLowerCase().trim();
  return {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif'
  }[type] || 'jpg';
}
