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
