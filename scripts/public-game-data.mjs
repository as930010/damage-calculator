import { basename } from 'node:path';

/** Exclude private maintenance manifests and expected-result files from copied data. */
export function isPublishableDataFile(path) {
  return basename(path) !== 'manifest.json' && !path.endsWith('-expected.json');
}

// Publish gameplay fields while excluding internal annotations and credentials.
const privateMetadataKeys = new Set([
  'metadata', 'provenance', 'internal', 'extractedAt', 'importedAt', 'coverage',
  'notes', 'note', 'developerNote', 'formula', 'dataUpdatedAt',
]);
const publicSourceKeys = new Set(['sourceId', 'sourceName', 'sources']);
const sensitiveKeys = new Set([
  'password', 'passwordhash', 'secret', 'clientsecret', 'apikey', 'privatekey',
  'accesstoken', 'refreshtoken', 'sessiontoken', 'authorization', 'credentials',
  'accesskey', 'secretkey', 'cookie',
]);

/** Publish semantic game data without changing identifiers or calculation values. */
export function publicGameData(value, key = '') {
  if (privateMetadataKeys.has(key)
      || (/^source(?:[A-Z_]|$)/.test(key) && !publicSourceKeys.has(key))) return undefined;
  if (sensitiveKeys.has(key.replace(/[_-]/g, '').toLowerCase())) {
    throw new Error(`Sensitive field in public data: ${key}`);
  }
  if (key === 'sourceId' && (typeof value !== 'string' || !/^[\p{L}\p{N}_-]+(?:[.:][\p{L}\p{N}_-]+)*$/u.test(value))) {
    throw new Error('Invalid public source identifier');
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error(`Non-finite number in public data: ${key}`);
  }
  if (Array.isArray(value)) return value.map(item => publicGameData(item)).filter(item => item !== undefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .map(([childKey, child]) => [childKey, publicGameData(child, childKey)])
      .filter(([, child]) => child !== undefined));
  }
  return value;
}
