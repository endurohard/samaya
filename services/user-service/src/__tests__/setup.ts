// Минимальный env, чтобы config.ts успешно валидировался в unit-тестах.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'unit_test_secret_minimum_32_characters_long_xxxx';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
