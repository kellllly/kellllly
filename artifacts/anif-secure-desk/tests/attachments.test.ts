import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAttachment, describeFile, formatSize } from '../src/lib/attachments.ts';

test('the browser applies the same rules as the API', () => {
  assert.deepEqual(checkAttachment('rapport.pdf', 'application/pdf', 10), { blocked: null, warnings: [] });
  assert.ok(checkAttachment('releve.pdf.exe', '', 10).blocked);
  assert.match(checkAttachment('budget.xlsm', '', 10).warnings.join(' '), /macros/);
  assert.match(checkAttachment('photo.jpg', 'image/jpeg', 10).warnings.join(' '), /EXIF/);
});

test('only a description and a SHA-256 of the file are produced', async () => {
  const bytes = new TextEncoder().encode('abc');
  const description = await describeFile({ name: 'a.txt', type: 'text/plain', size: 3, arrayBuffer: async () => bytes.buffer });
  assert.deepEqual(description, { name: 'a.txt', type: 'text/plain', size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' });
  assert.equal(formatSize(512), '512 o');
  assert.equal(formatSize(2048), '2 Ko');
  assert.equal(formatSize(3 * 1024 * 1024), '3 Mo');
});

// Oracle written independently of src/lib/attachments.ts: removing an extension
// from a list in the code must make one of these lines fail.
import { checkAttachment as apiCheckAttachment } from '../../api-server/src/lib/itsm-attachments.ts';

const BLOCKED = ['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'jar', 'lnk', 'dll', 'sys', 'cpl', 'sh', 'apk', 'app', 'iso', 'img', 'reg'];
const USUAL = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'txt', 'csv', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'];
const MACRO = ['docm', 'xlsm', 'pptm', 'dotm', 'xltm'];
const ARCHIVE = ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'cab'];
const ACTIVE = ['html', 'htm', 'svg', 'xml', 'eml', 'msg', 'rtf', 'mht'];
const IMAGES = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'tif', 'tiff'];

test('every executable or script extension is refused, wherever it sits in the name and whatever its case', () => {
  for (const ext of BLOCKED) {
    assert.equal(checkAttachment(`fichier.${ext}`, '', 10).blocked, `Fichier exécutable ou script (.${ext}) : envoi interdit.`, ext);
    assert.ok(checkAttachment(`FICHIER.${ext.toUpperCase()}`, '', 10).blocked, `${ext} en majuscules`);
    assert.ok(checkAttachment(`rapport.${ext}.pdf`, 'application/pdf', 10).blocked, `${ext} caché avant .pdf`);
    assert.deepEqual(checkAttachment(`fichier.${ext}`, '', 10).warnings, [], 'un refus ne porte pas d’avertissement');
  }
  assert.equal(checkAttachment('exe', '', 10).blocked, null, 'un nom sans point n’a pas d’extension');
  assert.equal(checkAttachment('rapport. exe ', '', 10).blocked, 'Fichier exécutable ou script (.exe) : envoi interdit.', 'espaces ignorés');
});

test('usual formats pass silently when the declared type matches; each risky family has its own warning', () => {
  const types: Record<string, string> = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', txt: 'text/plain', csv: 'text/csv',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  for (const ext of USUAL.filter((e) => !IMAGES.includes(e))) {
    assert.deepEqual(checkAttachment(`f.${ext}`, types[ext] ?? '', 10), { blocked: null, warnings: [] }, ext);
  }
  for (const ext of MACRO) assert.deepEqual(checkAttachment(`f.${ext}`, '', 10).warnings, ['Document Office avec macros : il peut exécuter du code à l’ouverture.'], ext);
  for (const ext of ARCHIVE) assert.deepEqual(checkAttachment(`f.${ext}`, '', 10).warnings, ['Archive compressée : son contenu n’est pas contrôlé avant l’ouverture.'], ext);
  for (const ext of ACTIVE) assert.deepEqual(checkAttachment(`f.${ext}`, '', 10).warnings, ['Format pouvant contenir des liens, scripts ou contenus distants.'], ext);
  for (const ext of IMAGES) assert.ok(checkAttachment(`f.${ext}`, '', 10).warnings.includes('Photo ou image : le pilote ne purge pas les métadonnées (EXIF, géolocalisation).'), ext);
  assert.deepEqual(checkAttachment('f.heic', '', 10).warnings, ['Format inhabituel (.heic) pour les échanges de l’agence.', 'Photo ou image : le pilote ne purge pas les métadonnées (EXIF, géolocalisation).']);
  assert.deepEqual(checkAttachment('notes', '', 10).warnings, ['Fichier sans extension : son format ne peut pas être reconnu.']);
  assert.deepEqual(checkAttachment('plan.dwg', '', 10).warnings, ['Format inhabituel (.dwg) pour les échanges de l’agence.']);
});

test('a double extension, a mismatched declared type, an empty file and the size limit are reported', () => {
  assert.deepEqual(checkAttachment('facture.pdf.zip', 'application/zip', 10).warnings, [
    'Double extension (.pdf.zip) : procédé courant pour déguiser un fichier.',
    'Archive compressée : son contenu n’est pas contrôlé avant l’ouverture.',
  ]);
  assert.deepEqual(checkAttachment('archive.tar.gz', '', 10).warnings, ['Archive compressée : son contenu n’est pas contrôlé avant l’ouverture.'], '.tar n’est pas un format usuel : pas de double extension');
  assert.deepEqual(checkAttachment('scan.pdf', 'image/png', 10).warnings, ['Le type déclaré (image/png) ne correspond pas à l’extension .pdf.']);
  assert.deepEqual(checkAttachment('scan.pdf', 'APPLICATION/PDF', 10).warnings, [], 'comparaison insensible à la casse');
  assert.deepEqual(checkAttachment('liste.csv', 'application/vnd.ms-excel', 10).warnings, [], 'CSV accepté sous ses trois types');
  assert.deepEqual(checkAttachment('liste.csv', 'text/plain', 10).warnings, []);
  assert.deepEqual(checkAttachment('vide.txt', 'text/plain', 0).warnings, ['Fichier vide.']);
  assert.equal(checkAttachment('gros.pdf', 'application/pdf', 25 * 1024 * 1024).blocked, null, '25 Mo pile acceptés');
  assert.equal(checkAttachment('gros.pdf', 'application/pdf', 25 * 1024 * 1024 + 1).blocked, 'Fichier de plus de 25 Mo : envoi interdit dans le pilote.');
});

test('the browser and the API give the same verdict for the same file', () => {
  const names = [...BLOCKED, ...USUAL, ...MACRO, ...ARCHIVE, ...ACTIVE, ...IMAGES, 'dwg', ''].flatMap((ext) => [`f.${ext}`, `rapport.pdf.${ext}`, `F.${ext.toUpperCase()}`]);
  for (const name of [...names, 'notes', 'scan.pdf', 'facture.pdf.zip', 'archive.tar.gz']) {
    for (const [type, size] of [['', 10], ['application/pdf', 10], ['image/png', 0], ['', 26 * 1024 * 1024]] as const) {
      assert.deepEqual(checkAttachment(name, type, size), apiCheckAttachment(name, type, size), `${name} ${type} ${size}`);
    }
  }
});

test('sizes are shown in octets, Ko then Mo with one decimal', () => {
  assert.equal(formatSize(0), '0 o');
  assert.equal(formatSize(1023), '1023 o');
  assert.equal(formatSize(1024), '1 Ko');
  assert.equal(formatSize(1536), '1.5 Ko');
  assert.equal(formatSize(1024 * 1024 - 1), '1024 Ko');
  assert.equal(formatSize(1024 * 1024), '1 Mo');
  assert.equal(formatSize(2.5 * 1024 * 1024), '2.5 Mo');
});
