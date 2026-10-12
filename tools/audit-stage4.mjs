import { readFile, writeFile } from 'node:fs/promises';
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createCashAudit, inspectCashSession, inspectRetention, inspectStatistics } from './stage4-audit-lib.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(`Diagnóstico de solo lectura. No migra, elimina ni configura TTL.
Sin red: node tools/audit-stage4.mjs cash --fixture=archivo.json [--output=informe.json]
Emulador: TENANT_ID y GOOGLE_CLOUD_PROJECT=demo-denzoz-ops; FIRESTORE_EMULATOR_HOST=127.0.0.1:8080.
  cash --session=ID [--budget=1000]
  statistics --store=ID --month=AAAA-MM [--budget=515]
  retention --uid=ID [--sample=100]
Datos remotos: requiere proyecto explícito y --allow-remote-read; consume lecturas.
Una conciliación correcta no autoriza migraciones ni acredita efectivo físico.`);
  process.exit(0);
}
const allowed = new Set(['fixture', 'output', 'session', 'store', 'month', 'budget', 'uid', 'sample', 'allow-remote-read']);
const options = new Map();
for (const arg of args.slice(1)) {
  const match = /^--([\w-]+)(?:=(.+))?$/.exec(arg);
  if (!match || !allowed.has(match[1]) || options.has(match[1])) throw new Error('Argumento inválido o duplicado. Usa --help.');
  if ((match[1] === 'allow-remote-read') !== (match[2] === undefined)) throw new Error('La opción requiere --nombre=valor.');
  options.set(match[1], match[2] ?? true);
}
const mode = args[0];
if (!['cash', 'statistics', 'retention'].includes(mode)) throw new Error('Modo inválido. Usa --help.');
let report;
if (options.has('fixture')) {
  if (mode !== 'cash') throw new Error('El fixture está disponible para cash.');
  const input = JSON.parse(await readFile(options.get('fixture'), 'utf8'));
  const audit = createCashAudit(input.tenantId, input.sessionId, input.session);
  for (const sale of input.sales) audit.add(sale.id, sale.data);
  report = { ...audit.finish(true, 0), source: 'offline_fixture' };
} else {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const tenantId = process.env.TENANT_ID;
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const emulator = ['127.0.0.1:8080', 'localhost:8080'].includes(host);
  if (!projectId || !tenantId) throw new Error('Define GOOGLE_CLOUD_PROJECT y TENANT_ID explícitamente.');
  if (host && !emulator) throw new Error('Solo se admite un emulador local en el puerto 8080.');
  if (emulator && projectId !== 'demo-denzoz-ops') throw new Error('El diagnóstico local requiere demo-denzoz-ops.');
  if (!emulator && (!options.has('allow-remote-read') || projectId.startsWith('demo-'))) throw new Error('Lecturas remotas deshabilitadas.');
  const app = initializeApp({ projectId, ...(emulator ? {} : { credential: applicationDefault() }) }, 'stage4-audit');
  const db = getFirestore(app);
  try {
    report = mode === 'cash'
      ? await inspectCashSession(db, tenantId, options.get('session'), Number(options.get('budget') ?? 1000))
      : mode === 'statistics'
        ? await inspectStatistics(db, tenantId, options.get('store'), options.get('month'), Number(options.get('budget') ?? 515))
        : await inspectRetention(db, tenantId, options.get('uid'), Number(options.get('sample') ?? 100));
    report.source = emulator ? 'local_emulator' : 'remote_read';
  } finally { await db.terminate(); await deleteApp(app); }
}
const json = JSON.stringify(report, null, 2);
if (options.has('output')) await writeFile(options.get('output'), `${json}\n`, { flag: 'wx' });
console.log(json);
