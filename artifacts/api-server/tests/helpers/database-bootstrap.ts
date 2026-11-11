const NO_DATABASE_TEST_URL = "postgres://test:test@127.0.0.1:1/no-database-test";

/**
 * Some route bundles import @workspace/db even when their test supplies every
 * storage dependency. Initialize those bundles without connecting to a real DB.
 */
export async function importWithTestDatabaseUrl<T>(load: () => Promise<T>): Promise<T> {
  const originalUrl = process.env.DATABASE_URL;
  if (originalUrl) return load();

  process.env.DATABASE_URL = NO_DATABASE_TEST_URL;
  try {
    return await load();
  } finally {
    delete process.env.DATABASE_URL;
  }
}
