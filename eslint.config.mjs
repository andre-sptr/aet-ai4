import tseslint from 'typescript-eslint';
import nextVitals from 'eslint-config-next/core-web-vitals';
export default [
  {ignores:['**/node_modules/**','**/.next/**','**/out/**','**/dist/**','**/next-env.d.ts','**/*.tsbuildinfo']},
  ...tseslint.configs.recommended,
  ...nextVitals.map(config => ({...config, files:['apps/web/**/*.{ts,tsx,js,mjs}']})),
  {settings:{next:{rootDir:'apps/web/'}},rules:{'@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}]}},
];
