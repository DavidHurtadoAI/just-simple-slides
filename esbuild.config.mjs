import esbuild from 'esbuild';
const build = await esbuild.context({
  entryPoints: ['src/main.ts'], bundle: true, format: 'cjs', platform: 'browser',
  target: 'es2020', minify: !process.argv.includes('--watch'),
  external: ['obsidian', '@codemirror/state', '@codemirror/view', '@codemirror/commands', '@codemirror/search'],
  outfile: 'main.js', legalComments: 'eof',
});
if (process.argv.includes('--watch')) await build.watch();
else { await build.rebuild(); await build.dispose(); }
