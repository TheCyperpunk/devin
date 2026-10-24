// Inserts 12 FICTIONAL relief reports around Ernakulam district into the hub database, for practice and screenshots.
// Safe to re-run (fixed ids). Names are made up; nothing here is real personal data (D11).
// Usage: npm run seed      (stop the hub first, or restart it afterwards so dashboards reload)
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NeedType, PhoneReportInput } from '@relief-mesh/shared';
import { HubDb } from '../server/src/db.js';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'data');
mkdirSync(dataDir, { recursive: true });
const db = new HubDb(path.join(dataDir, 'hub.db'));

const MIN = 60_000;
const volunteers = [
  { deviceId: 'seed-device-aluva-01', name: 'Demo volunteer A (seed)' },
  { deviceId: 'seed-device-paravur-1', name: 'Demo volunteer B (seed)' },
  { deviceId: 'seed-device-fort-kochi', name: 'Demo volunteer C (seed)' },
];
for (const v of volunteers) {
  // Random token hash that nobody holds: seed devices exist only to own the sample reports.
  db.upsertDevice(v.deviceId, v.name, createHash('sha256').update(randomBytes(32)).digest('hex'), Date.now());
}

interface Seed {
  v: number;
  needs: NeedType[];
  people: number;
  children?: boolean;
  elderly?: boolean;
  urgent?: boolean;
  note?: string;
  at: [number, number]; // approximate lat, lng of the named area
  waitedMin: number;
}

const seeds: Seed[] = [
  { v: 0, needs: ['medical', 'rescue'], people: 6, children: true, elderly: true, urgent: true, note: 'Aluva: first floor flooded, diabetic patient needs insulin', at: [10.1076, 76.3516], waitedMin: 95 },
  { v: 0, needs: ['water', 'food'], people: 14, children: true, note: 'Aluva: families on terrace since last night', at: [10.1004, 76.357], waitedMin: 70 },
  { v: 1, needs: ['rescue'], people: 9, elderly: true, urgent: true, note: 'North Paravur: water rising, need boat', at: [10.1458, 76.2231], waitedMin: 40 },
  { v: 1, needs: ['food'], people: 22, note: 'North Paravur: community hall, rice and dal needed', at: [10.1402, 76.2279], waitedMin: 120 },
  { v: 2, needs: ['medical'], people: 2, elderly: true, note: 'Fort Kochi: oxygen cylinder running low', at: [9.9658, 76.2421], waitedMin: 25 },
  { v: 2, needs: ['shelter', 'water'], people: 11, children: true, note: 'Fort Kochi: house roof damaged, need shelter tonight', at: [9.9639, 76.2433], waitedMin: 55 },
  { v: 0, needs: ['water'], people: 5, note: 'Kalamassery: drinking water finished', at: [10.0531, 76.3159], waitedMin: 15 },
  { v: 1, needs: ['medical', 'food'], people: 3, children: true, urgent: true, note: 'Eloor: infant with fever, no formula', at: [10.077, 76.299], waitedMin: 10 },
  { v: 2, needs: ['shelter'], people: 18, elderly: true, note: 'Kadamakkudy: island families waiting for camp space', at: [10.005, 76.268], waitedMin: 200 },
  { v: 0, needs: ['food', 'water'], people: 30, note: 'Aluva: relief camp supplies low', at: [10.093, 76.349], waitedMin: 5 },
  { v: 1, needs: ['rescue', 'medical'], people: 4, elderly: true, urgent: true, note: 'North Paravur: person with a fracture, road cut off', at: [10.1491, 76.2194], waitedMin: 30 },
  { v: 2, needs: ['water'], people: 8, note: 'Fort Kochi: tank contaminated, need clean water', at: [9.9672, 76.2398], waitedMin: 150 },
];

let created = 0;
seeds.forEach((s, i) => {
  const vol = volunteers[s.v]!;
  const id = createHash('sha1').update('relief-mesh-seed-' + i).digest('hex');
  const uuid = `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-a${id.slice(17, 20)}-${id.slice(20, 32)}`;
  const input: PhoneReportInput = {
    id: uuid,
    needs: s.needs,
    peopleCount: s.people,
    hasChildren: s.children ?? false,
    hasElderlyOrSick: s.elderly ?? false,
    urgent: s.urgent ?? false,
    note: s.note,
    lat: s.at[0],
    lng: s.at[1],
    accuracyM: 25,
    ageMs: s.waitedMin * MIN,
  };
  const out = db.submit({ deviceId: vol.deviceId, reporterName: vol.name }, input, Date.now());
  if (out.result === 'created') created++;
});

console.log(`Seeded ${created} new fictional reports (${seeds.length - created} already present). Database: ${path.join(dataDir, 'hub.db')}`);
db.close();
