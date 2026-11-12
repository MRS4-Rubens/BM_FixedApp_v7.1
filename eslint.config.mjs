import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Social preview images render through next/og, where <img> is the only option. Next's
    // no-img-element rule already skips these files on Linux but not on Windows (its path check
    // only converts the first "\"), so switch it off here to get the same result on every OS.
    files: ['app/**/opengraph-image.tsx', 'app/**/twitter-image.tsx'],
    rules: { '@next/next/no-img-element': 'off' },
  },
  globalIgnores([
    '.next/**',
    '.claude/**',
    'out/**',
    'build/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
  ]),
])

export default eslintConfig
