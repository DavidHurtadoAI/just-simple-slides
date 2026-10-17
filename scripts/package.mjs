import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const versions = JSON.parse(await readFile('versions.json', 'utf8'));
if (manifest.version !== pkg.version || versions[pkg.version] !== manifest.minAppVersion) throw Error('Version mismatch');
await mkdir('dist', { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) {
  if (!(await stat(file)).size) throw Error(`Empty asset: ${file}`);
  await copyFile(file, `dist/${file}`);
}
console.log(`Packaged ${manifest.name} ${manifest.version} in dist/`);
