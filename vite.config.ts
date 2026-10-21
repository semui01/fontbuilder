import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build works from any folder or GitHub Pages sub-path.
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
