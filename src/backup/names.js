// The daily backups' names in the BACKUPS bucket, and which are past
// keeping. Pure, so it's easy to test.

export const BACKUP_DAYS = 30;
const NAME = /^notonawa-daily-(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z\.json\.gz\.enc$/;

/**
 * e.g. notonawa-daily-20261017T031700Z.json.gz.enc
 * @param {number} now
 */
export function backupKey(now) {
  const stamp = new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
  return `notonawa-daily-${stamp}.json.gz.enc`;
}

/**
 * Which of these are backups older than BACKUP_DAYS. Anything else in the
 * bucket is left alone.
 * @param {string[]} keys
 * @param {number} now
 */
export function expiredBackupKeys(keys, now) {
  const cutoff = now - BACKUP_DAYS * 24 * 60 * 60 * 1000;
  return keys.filter((key) => {
    const m = key.match(NAME);
    return m !== null && Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) < cutoff;
  });
}
