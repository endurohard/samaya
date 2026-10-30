import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/__tests__/setup.ts'],
    // src/ai/price.test.ts сюда НЕ включён намеренно: это самостоятельный
    // скрипт (`npx tsx src/ai/price.test.ts`) со своим process.exit, и под
    // vitest он падает на выходе из процесса, а не на проверках.
    include: ['src/__tests__/**/*.test.ts'],
  },
});
