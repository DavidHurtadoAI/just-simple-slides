import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  { ignores: ['main.js', 'dist/**', 'qa/**', 'node_modules/**', 'tests/**', 'scripts/**', 'esbuild.config.mjs'] },
  ...obsidianmd.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'obsidianmd/ui/sentence-case': ['error', { brands: ['Just Simple Slides', 'Obsidian', 'Markdown', 'CodeMirror'] }],
    },
  },
]);
