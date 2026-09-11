// Apply the two-script integration only to the reviewed student-page blob.
// This script has no network, database, storage-service or deployment operations.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const path = new URL('../public/index.html', import.meta.url);
const content = await readFile(path);
const html = content.toString('utf8');
const scripts = '  <script src="/photo-pipeline.js" defer></script>\n  <script src="/photo-upload.js" defer></script>\n';
if (html.includes(scripts)) {
  console.log('Photo pipeline is already integrated.');
} else {
  const sha = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
  if (sha !== '4b6e914c41e51e6449100c5088bccf9e3cd57a95') {
    throw new Error('Student HTML differs from the reviewed baseline; manual integration review required.');
  }
  if (html.split('</body>').length !== 2 || html.includes('/photo-pipeline.js') || html.includes('/photo-upload.js')) {
    throw new Error('Unexpected or partial photo pipeline integration.');
  }
  await writeFile(path, html.replace('</body>', `${scripts}</body>`));
  console.log('Added ordered classic deferred scripts; original student functions and data APIs unchanged.');
}
