// Minimal env for config module to parse without process.exit(1)
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://localhost/test';
process.env.JWT_SECRET = 'test_secret_at_least_32_characters_long!!';
