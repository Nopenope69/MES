import * as fs from 'fs';
import * as path from 'path';

const fixtureDir = path.join(process.cwd(), 'apps', 'api', 'tests', 'fixtures', 'reflow');
if (!fs.existsSync(fixtureDir)) {
  fs.mkdirSync(fixtureDir, { recursive: true });
}

// Helper to generate the benchmark compliant curve points
function generateBenchmarkPoints(talDuration: number = 64): Array<{ t: number; tc1: number; tc2: number }> {
  const points: Array<{ t: number; tc1: number; tc2: number }> = [];

  // 1. Ramp: t=0 to 70s, 25°C to 150°C (1.8 °C/s up to 69s, 150 at 70s)
  for (let t = 0; t < 70; t++) {
    const temp = Number((25.0 + 1.8 * t).toFixed(2));
    points.push({ t, tc1: temp, tc2: Number((temp + 0.5).toFixed(2)) });
  }
  points.push({ t: 70, tc1: 150.0, tc2: 150.5 });

  // 2. Soak: t=71 to 155s (85s duration, 150°C to 200°C)
  for (let t = 71; t <= 155; t++) {
    const temp = Number((150.0 + (50.0 / 85.0) * (t - 70)).toFixed(2));
    points.push({ t, tc1: temp, tc2: Number((temp + 0.3).toFixed(2)) });
  }

  // 3. Rise to liquidus: t=156 to 165s (200°C to 217°C)
  for (let t = 156; t <= 165; t++) {
    const temp = Number((200.0 + (17.0 / 10.0) * (t - 155)).toFixed(2));
    points.push({ t, tc1: temp, tc2: Number((temp + 0.2).toFixed(2)) });
  }

  // 4. TAL rise to peak 241.5°C
  const halfTal = Math.floor(talDuration / 2);
  const tPeak = 165 + halfTal;
  const tTalDown = 165 + talDuration;

  for (let t = 166; t < tPeak; t++) {
    const temp = Number((217.0 + (24.5 / (tPeak - 165)) * (t - 165)).toFixed(2));
    points.push({ t, tc1: temp, tc2: Number((temp + 0.2).toFixed(2)) });
  }
  points.push({ t: tPeak, tc1: 241.5, tc2: 241.8 });

  for (let t = tPeak + 1; t < tTalDown; t++) {
    const temp = Number((241.5 - (24.5 / (tTalDown - tPeak)) * (t - tPeak)).toFixed(2));
    points.push({ t, tc1: temp, tc2: Number((temp + 0.2).toFixed(2)) });
  }
  points.push({ t: tTalDown, tc1: 217.0, tc2: 217.2 });

  // 5. Cooling: fall at 2.6 °C/s down to ~50°C
  for (let t = tTalDown + 1; t <= tTalDown + 65; t++) {
    const currentTemp = Number((217.0 - 2.6 * (t - tTalDown)).toFixed(2));
    if (currentTemp < 40) break;
    points.push({ t, tc1: currentTemp, tc2: Number((currentTemp + 0.2).toFixed(2)) });
  }

  return points;
}

// 1. kic-golden.kic
const compliantPoints = generateBenchmarkPoints(64);
let kicContent = `[KIC 2000 Profile]\nMODEL = SlimKIC 2000\nSERIAL = KIC-99214\nSAMPLEINTERVAL = 1.0\nRECIPE = SAC305_STANDARD\nCONVEYORSPEED = 95.0\nTEMPERATUREUNIT = C\nTIMEUNIT = SEC\nTC1 = Leading Edge\nTC2 = BGA Center\nOFFSET1 = 0.0\nOFFSET2 = 0.0\n[DATA]\nTime,TC1,TC2\n`;
compliantPoints.forEach(p => {
  kicContent += `${p.t.toFixed(1)},${p.tc1.toFixed(1)},${p.tc2.toFixed(1)}\n`;
});
fs.writeFileSync(path.join(fixtureDir, 'kic-golden.kic'), kicContent, 'utf8');

// 2. datapaq-golden.paq
let datapaqContent = `// Datapaq Insight File\nLogger: Datapaq Q18\nSerial: DPQ-88371\nInterval: 1.0\nUnits: C\n\nDate: 2026-09-08\nTime\tTC1 (Leading)\tTC2 (BGA)\n`;
compliantPoints.forEach(p => {
  datapaqContent += `${p.t.toFixed(1)}\t${p.tc1.toFixed(1)}\t${p.tc2.toFixed(1)}\n`;
});
fs.writeFileSync(path.join(fixtureDir, 'datapaq-golden.paq'), datapaqContent, 'utf8');

// 3. mole-golden.mdm
let moleContent = `; ECD M.O.L.E. Data File\nInstrument: SuperM.O.L.E. Gold 2\nSerial: ECD-44129\nRate: 1.0\nUnit: C\n\n[Data]\nSec\tProbe1\tProbe2\n`;
compliantPoints.forEach(p => {
  moleContent += `${p.t.toFixed(1)}\t${p.tc1.toFixed(1)}\t${p.tc2.toFixed(1)}\n`;
});
fs.writeFileSync(path.join(fixtureDir, 'mole-golden.mdm'), moleContent, 'utf8');

// 4. out-of-spec-tal.kic (TAL = 38s)
const failPoints = generateBenchmarkPoints(38);
let kicFailContent = `[KIC 2000 Profile]\nMODEL = SlimKIC 2000\nSERIAL = KIC-99214\nSAMPLEINTERVAL = 1.0\nRECIPE = SAC305_STANDARD\nCONVEYORSPEED = 95.0\nTEMPERATUREUNIT = C\nTIMEUNIT = SEC\nTC1 = Leading Edge\nTC2 = BGA Center\n[DATA]\nTime,TC1,TC2\n`;
failPoints.forEach(p => {
  kicFailContent += `${p.t.toFixed(1)},${p.tc1.toFixed(1)},${p.tc2.toFixed(1)}\n`;
});
fs.writeFileSync(path.join(fixtureDir, 'out-of-spec-tal.kic'), kicFailContent, 'utf8');

// 5. corrupt-timestamps.kic (non-monotonic)
let corruptContent = `[KIC 2000 Profile]\nMODEL = SlimKIC 2000\nSERIAL = KIC-99214\nSAMPLEINTERVAL = 1.0\n[DATA]\nTime,TC1,TC2\n0.0,25.0,25.0\n1.0,26.8,26.8\n3.0,30.4,30.4\n2.0,28.6,28.6\n4.0,32.2,32.2\n`;
fs.writeFileSync(path.join(fixtureDir, 'corrupt-timestamps.kic'), corruptContent, 'utf8');

// 6. xxe-payload.xml
const xxeContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<reflow_profile>
  <data>&xxe;</data>
</reflow_profile>`;
fs.writeFileSync(path.join(fixtureDir, 'xxe-payload.xml'), xxeContent, 'utf8');

// 7. high-variance-drift.json (mean stable, high variance)
const highVarianceTelemetry = [];
const now = new Date('2026-09-08T12:00:00.000Z').getTime();
for (let i = 0; i < 30; i++) {
  const z8 = i % 2 === 0 ? 210.0 : 270.0;
  highVarianceTelemetry.push({
    timestamp: new Date(now + i * 1000).toISOString(),
    conveyorSpeedMPerMin: 0.95,
    oxygenPpm: 450,
    zoneTemperatures: [160, 165, 175, 185, 195, 210, 230, z8, 245, 180]
  });
}
fs.writeFileSync(
  path.join(fixtureDir, 'high-variance-drift.json'),
  JSON.stringify(highVarianceTelemetry, null, 2),
  'utf8'
);

console.log('Successfully generated all 7 Phase 6 reflow fixtures in', fixtureDir);
