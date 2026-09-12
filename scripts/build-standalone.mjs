import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('\n================================================================================');
console.log('   🔨 BUILDING ANTIGRAVITY SMT MES STANDALONE EXECUTABLE (.EXE & MACOS)');
console.log('================================================================================\n');

// 1. Verify schema file exists
console.log('[1/7] Verifying SQLite DDL schema...');
const schemaSqlPath = path.join(rootDir, 'apps/api/src/db/schema.sql');
if (!fs.existsSync(schemaSqlPath)) {
  throw new Error(`Schema file not found at ${schemaSqlPath}`);
}
console.log('  ✓ apps/api/src/db/schema.sql verified.');

// 2. Build Shared Domain Library
console.log('\n[2/7] Compiling @mes/shared library...');
execSync('npm --workspace=@mes/shared run build', { cwd: rootDir, stdio: 'inherit' });
console.log('  ✓ @mes/shared compiled.');

// 3. Build React Cleanroom Cockpit Web App
console.log('\n[3/7] Compiling @mes/web production bundle (10 Cleanroom Stations)...');
execSync('npm --workspace=@mes/web run build', { cwd: rootDir, stdio: 'inherit' });
console.log('  ✓ @mes/web compiled.');

// 4. Prepare dist-standalone directory
console.log('\n[4/7] Preparing dist-standalone directory structure...');
const distStandaloneDir = path.join(rootDir, 'dist-standalone');
const distPublicDir = path.join(distStandaloneDir, 'public');
fs.rmSync(distStandaloneDir, { recursive: true, force: true });
fs.mkdirSync(distPublicDir, { recursive: true });

// Copy web assets to dist-standalone/public
const webDistDir = path.join(rootDir, 'apps/web/dist');
fs.cpSync(webDistDir, distPublicDir, { recursive: true });
console.log('  ✓ Web Cockpit static assets copied to dist-standalone/public.');

// 5. Bundle with esbuild
console.log('\n[5/7] Bundling standalone server with esbuild...');
const esbuildCmd = `npx esbuild apps/api/src/server.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist-standalone/server.cjs --external:node:sqlite --external:pg-native`;
execSync(esbuildCmd, { cwd: rootDir, stdio: 'inherit' });
console.log('  ✓ dist-standalone/server.cjs generated.');

// Create dist-standalone/package.json for pkg
const pkgConfig = {
  name: 'mes-simulator',
  version: '1.0.0',
  bin: 'server.cjs',
  pkg: {
    assets: ['public/**/*']
  }
};
fs.writeFileSync(
  path.join(distStandaloneDir, 'package.json'),
  JSON.stringify(pkgConfig, null, 2),
  'utf-8'
);

// 6. Compile single-file executables with @yao-pkg/pkg
console.log('\n[6/7] Compiling native standalone binaries with pkg (Node 22)...');
const releaseDir = path.join(rootDir, 'release');
fs.mkdirSync(releaseDir, { recursive: true });

// Packaging for Windows x64 and macOS arm64
const targets = 'node22-win-x64,node22-macos-arm64';
const pkgCmd = `npx --yes @yao-pkg/pkg -t ${targets} dist-standalone/package.json --out-path release`;
console.log(`  Running: ${pkgCmd}`);
execSync(pkgCmd, { cwd: rootDir, stdio: 'inherit' });

// Rename binaries to descriptive names if needed
const winOld = path.join(releaseDir, 'mes-simulator-win-x64.exe');
const winNew = path.join(releaseDir, 'mes-simulator-win.exe');
if (fs.existsSync(winOld)) {
  fs.renameSync(winOld, winNew);
}

const macOld = path.join(releaseDir, 'mes-simulator-macos-arm64');
const macNew = path.join(releaseDir, 'mes-simulator-macos');
if (fs.existsSync(macOld)) {
  fs.renameSync(macOld, macNew);
  fs.chmodSync(macNew, 0o755);
}

// Also copy public/ to release/public for portability
const releasePublicDir = path.join(releaseDir, 'public');
fs.rmSync(releasePublicDir, { recursive: true, force: true });
fs.cpSync(distPublicDir, releasePublicDir, { recursive: true });

// 7. Write Colleague Quick-Start Guide
console.log('\n[7/7] Generating Colleague Quick-Start Guide (release/README.txt)...');
const readmeContent = `================================================================================
   ANTIGRAVITY SMT CLEANROOM MES - STANDALONE SIMULATOR & WORKSTATION
================================================================================
Version: 1.0.0 (Phases 1-6 Enterprise Architecture)
Distribution Package: Zero Installation / Standalone Executable

QUICK START INSTRUCTIONS:
-------------------------
For Windows Colleagues:
  1. Double-click "mes-simulator-win.exe" (or run it in Command Prompt / PowerShell).
  2. The embedded MES engine starts automatically and creates "mes_local.db" in the same folder.
  3. Your default web browser will automatically open to:
     http://localhost:4000/
  4. That's it! No Node.js, no Python, no Git, and no database installation required.

For macOS Colleagues:
  1. In Terminal, navigate to this folder and run:
     ./mes-simulator-macos
  2. The Cleanroom Cockpit opens automatically in your browser at http://localhost:4000/

AVAILABLE WORKSTATIONS & CLEANROOM TABS:
-----------------------------------------
Tab 1:  Operator Station        - SMT Assembly Line Execution & Barcode Dispatch
Tab 2:  Supervisor Dashboard    - eBR Electronic Batch Records & Part 11 Sign-off
Tab 3:  Traceability Genealogy  - Deep Component & PCB Panel Genealogy Trees
Tab 4:  Component Splicing      - Feeder Reel Setup, MSL Clocks & Interlocks
Tab 5:  Solder Paste & 3D SPI   - Stencil Lifespan, Inspection & Squeegee Tuning
Tab 6:  3D AOI & Defect Sentinel- Optical Inspection & Repeat Defect Production Halt
Tab 7:  Reflow Profiling (Ph.6) - KIC/Datapaq/MOLE PWI Engine & Oven Drift Actuation
Tab 8:  Autonomous AGV Fleet    - Floor Navigation, Missions & Replenishment Dispatch
Tab 9:  Predictive Intelligence - Weibull Reliability, SPC Cpk & Mahalanobis Distance
Tab 10: SRE & Topology Health   - System RED Metrics, Ingress Pipeline & SLO Status

ADDITIONAL NETWORK ENDPOINTS:
----------------------------
Interactive API Docs (Swagger):  http://localhost:4000/api-docs
OpenAPI 3.1 Specification:       http://localhost:4000/api/v1/openapi.json
Prometheus Metrics (RED/USE):    http://localhost:4000/metrics
Fuji Nexim TCP Socket Gateway:   tcp://localhost:30040

DATABASE PERSISTENCE & RESET:
-----------------------------
- All events, inspections, batches, and profiles are saved in "mes_local.db" in the current directory.
- To reset the cleanroom to factory fresh baseline state:
  Simply delete "mes_local.db" and re-launch the executable.

Enjoy testing the MES Simulator!
================================================================================
`;
fs.writeFileSync(path.join(releaseDir, 'README.txt'), readmeContent, 'utf-8');

// Also create chunk parts for Git version control without large file size timeouts
console.log('Generating 5MB Git-friendly binary chunks and restore scripts...');
try {
  // Remove any previous part files
  const existingParts = fs.readdirSync(releaseDir).filter(f => f.startsWith('mes-simulator-win.exe.part'));
  for (const p of existingParts) {
    fs.unlinkSync(path.join(releaseDir, p));
  }
  execSync('split -b 5m mes-simulator-win.exe mes-simulator-win.exe.part', { cwd: releaseDir });
  
  const restoreBat = `@echo off\r\necho Assembling mes-simulator-win.exe from parts...\r\ncopy /b mes-simulator-win.exe.part* mes-simulator-win.exe\r\necho Assembly complete! Run mes-simulator-win.exe to start.\r\npause\r\n`;
  fs.writeFileSync(path.join(releaseDir, 'restore-win.bat'), restoreBat, 'utf-8');

  const restoreSh = `#!/bin/bash\ncat release/mes-simulator-win.exe.part* > release/mes-simulator-win.exe\nchmod +x release/mes-simulator-win.exe\necho "mes-simulator-win.exe assembled!"\n`;
  fs.writeFileSync(path.join(releaseDir, 'restore-unix.sh'), restoreSh, 'utf-8');
  fs.chmodSync(path.join(releaseDir, 'restore-unix.sh'), 0o755);
  console.log('  ✓ 5MB chunks and restore-win.bat generated.');
} catch (err) {
  console.warn('  (split command failed:', err.message, ')');
}

// Also create zip archive for Windows distribution
console.log('Creating Windows distribution archive (release/mes-simulator-windows-x64.zip)...');
try {
  execSync('zip -q -r mes-simulator-windows-x64.zip mes-simulator-win.exe public README.txt', {
    cwd: releaseDir
  });
  console.log('  ✓ release/mes-simulator-windows-x64.zip created.');
} catch {
  console.warn('  (zip command not available, skipping archive compression)');
}

console.log('\n================================================================================');
console.log('   ✅ STANDALONE EXECUTABLES READY IN release/ FOLDER:');
console.log('================================================================================');
const releaseFiles = fs.readdirSync(releaseDir);
for (const f of releaseFiles) {
  const stat = fs.statSync(path.join(releaseDir, f));
  const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);
  console.log(`  • ${f.padEnd(35)} (${sizeMb} MB)`);
}
console.log('\n');
