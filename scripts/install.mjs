import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const vault = process.argv[2];
if (!vault) throw Error('Usage: node scripts/install.mjs <vault-folder>');
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const destination = path.resolve(vault, '.obsidian', 'plugins', manifest.id);
await mkdir(destination, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) await copyFile(`dist/${file}`, path.join(destination, file));
console.log(`Installed ${manifest.name} in ${destination}`);
