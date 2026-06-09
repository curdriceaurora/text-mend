// Stage a clean, shippable copy of the extension (manifest + src + icons only) under
// dist/text-mend/ — no node_modules, tests, tools, docs, or git. Used for Load-unpacked
// testing, the store zip, and as the input to a .crx pack. Run: npm run package
import { rmSync, mkdirSync, cpSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const out = join(dist, 'text-mend');

rmSync(dist, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'manifest.json'), join(out, 'manifest.json'));
cpSync(join(root, 'src'), join(out, 'src'), { recursive: true });
cpSync(join(root, 'icons'), join(out, 'icons'), { recursive: true });

console.log(`staged clean package -> ${out}`);
