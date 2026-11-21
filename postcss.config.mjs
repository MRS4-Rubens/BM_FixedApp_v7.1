import { fileURLToPath } from 'node:url'

const config = {
  plugins: {
    '@tailwindcss/postcss': {},
    [fileURLToPath(new URL('./config/desktop-canvas-postcss.cjs', import.meta.url))]: {},
  },
}

export default config
