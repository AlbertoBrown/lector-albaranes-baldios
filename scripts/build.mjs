import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const vendor = join(root, 'dist/vendor');
const packageDir = name => dirname(require.resolve(`${name}/package.json`));
const pdf = packageDir('pdfjs-dist');
const ocr = packageDir('tesseract.js');
const core = packageDir('tesseract.js-core');
await mkdir(join(vendor, 'core'), { recursive: true });
await mkdir(join(vendor, 'lang'), { recursive: true });

for (const name of ['pdf.mjs', 'pdf.worker.mjs']) {
  await cp(join(pdf, 'build', name), join(vendor, name));
}
for (const name of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(join(pdf, name), join(vendor, name), { recursive: true });
}
for (const name of ['tesseract.min.js', 'worker.min.js']) {
  await cp(join(ocr, 'dist', name), join(vendor, name));
}
for (const name of await readdir(core)) {
  if (/\.wasm(?:\.js)?$/.test(name)) await cp(join(core, name), join(vendor, 'core', name));
}
for (const [directory, name, license] of [[pdf, 'PDFJS', 'LICENSE'], [ocr, 'TESSERACT', 'LICENSE.md'], [core, 'TESSERACT-CORE', 'LICENSE']]) {
  await cp(join(directory, license), join(vendor, `${name}-LICENSE.txt`));
}

const model = join(vendor, 'lang/spa.traineddata');
const expectedHash = '6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464';
const hash = data => createHash('sha256').update(data).digest('hex');
let existing;
try { existing = await readFile(model); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!existing || hash(existing) !== expectedHash) {
  console.log('Descargando modelo OCR español…');
  const url = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/923915d4ced2a7235221788285785a29c4a42d4a/spa.traineddata';
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`No se pudo descargar el modelo OCR: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (hash(data) !== expectedHash) throw new Error('El modelo OCR no coincide con su SHA-256 esperado.');
  await writeFile(model, data);
}
await cp(join(core, 'LICENSE'), join(vendor, 'lang/LICENSE.txt'));
console.log('Preparado: dist contiene la aplicación, las librerías y el modelo OCR local.');
