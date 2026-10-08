import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('.', import.meta.url));
const env = { ...process.env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199' };
for (const file of ['functions-inventory.test.mjs', 'calendar-emulator.test.mjs', 'migration-emulator.test.mjs', 'firestore-rules.test.mjs', 'frontend-security.test.mjs', 'fiscal-payload.test.mjs', 'backend-indexes.test.mjs', 'backend-audit-regressions.test.mjs']) {
  const result = spawnSync(process.execPath, ['--test', file], { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
