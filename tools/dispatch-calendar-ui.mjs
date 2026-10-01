import { createRequire } from 'node:module';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('Solo se permiten emuladores locales.');
process.env.GCLOUD_PROJECT = 'demo-denzoz-ops';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
await require('./lib/calendar.js').runCalendarReminders();
