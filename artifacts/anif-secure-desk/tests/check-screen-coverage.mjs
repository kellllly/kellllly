/**
 * Seuil bloquant de couverture des écrans testés dans jsdom (lu dans le rapport lcov).
 * Les branches et les fonctions font foi : dans le bundle esbuild, les source maps
 * comptent les lignes d'en-tête (imports, commentaires) comme non couvertes, d'où un
 * pourcentage de lignes sous-estimé et variable d'un passage à l'autre.
 */
import { readFileSync } from 'node:fs';

const SCREENS = [
  'src/components/audit-integrity.tsx',
  'src/components/audit-siem.tsx',
  'src/components/audit-timestamps.tsx',
  'src/components/diagnostic-assistant.tsx',
  'src/pages/assets.tsx',
  'src/pages/audit.tsx',
  'src/pages/dashboard.tsx',
  'src/pages/governance.tsx',
  'src/pages/messages.tsx',
  'src/pages/services.tsx',
  'src/pages/settings.tsx',
  'src/pages/tickets.tsx',
];
const MIN = { branches: 75, functions: 60 };

const report = readFileSync(process.argv[2] ?? '.component-build/lcov.info', 'utf8');
const files = new Map();
for (const record of report.split('end_of_record')) {
  // lcov paths use backslashes on Windows.
  const path = record.match(/^SF:(.+)$/mu)?.[1]?.trim().replaceAll('\\', '/');
  if (!path) continue;
  const value = (key) => Number(record.match(new RegExp(`^${key}:(\\d+)$`, 'mu'))?.[1] ?? 0);
  files.set(path, { BRF: value('BRF'), BRH: value('BRH'), FNF: value('FNF'), FNH: value('FNH') });
}
const pct = (hit, found) => (found ? (100 * hit) / found : 100);
let failed = false;
for (const screen of SCREENS) {
  const entry = [...files].find(([path]) => path.endsWith(screen))?.[1];
  if (!entry) { console.error(`✗ ${screen} : absent du rapport (écran plus testé ?)`); failed = true; continue; }
  const branches = pct(entry.BRH, entry.BRF);
  const functions = pct(entry.FNH, entry.FNF);
  const ok = branches >= MIN.branches && functions >= MIN.functions;
  failed ||= !ok;
  console.log(`${ok ? '✓' : '✗'} ${screen} : branches ${branches.toFixed(1)} % (min ${MIN.branches}), fonctions ${functions.toFixed(1)} % (min ${MIN.functions})`);
}
process.exit(failed ? 1 : 0);
