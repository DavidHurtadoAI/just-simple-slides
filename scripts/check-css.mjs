import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import doiuse from 'doiuse';

const file = process.argv[2] ?? 'styles.css';
const css = await readFile(file, 'utf8');
// Chromium 114 is the conservative browser baseline used by the Obsidian validator.
const result = await postcss([doiuse({ browsers: ['Chrome 114'] })]).process(css, { from: file });
const problems = result.warnings().map(warning => warning.toString());
result.root.walkDecls(declaration => {
  if (declaration.important) problems.push(`${file}:${declaration.source.start.line}: Avoid !important; use selector specificity.`);
});
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else console.log('CSS: no !important declarations or unsupported browser features.');
