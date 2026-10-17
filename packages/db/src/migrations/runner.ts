import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(connectionString: string): Promise<string[]> {
  const sql = postgres(connectionString, { max: 1 });
  const appliedMigrations: string[] = [];

  try {
    // 1. Ensure migrations tracking table exists
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        id serial PRIMARY KEY,
        name varchar(255) NOT NULL UNIQUE,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `;

    // 2. Discover migration files
    let migrationsDir = __dirname;
    const currentFiles = fs.existsSync(migrationsDir) ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')) : [];
    if (currentFiles.length === 0) {
      const srcDir = path.resolve(__dirname, '../../src/migrations');
      if (fs.existsSync(srcDir)) {
        migrationsDir = srcDir;
      }
    }
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const [existing] = await sql`
        SELECT name FROM _migrations WHERE name = ${file}
      `;

      if (existing) {
        continue;
      }

      console.log(`Applying migration: ${file}...`);
      const filePath = path.join(migrationsDir, file);
      const fileContent = fs.readFileSync(filePath, 'utf-8');

      // Execute migration inside a transaction
      await sql.begin(async (txn) => {
        await txn.unsafe(fileContent);
        await txn`
          INSERT INTO _migrations (name) VALUES (${file})
        `;
      });

      appliedMigrations.push(file);
      console.log(`Successfully applied migration: ${file}`);
    }

    return appliedMigrations;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Migrations run as the database owner; the runtime logins (workspace_api / workspace_worker) cannot.
  const url = process.env['DATABASE_MIGRATION_URL'] || process.env['DATABASE_DIRECT_URL'] || process.env['DATABASE_URL'];
  if (!url) {
    console.error('Error: DATABASE_MIGRATION_URL (or DATABASE_DIRECT_URL / DATABASE_URL) must be set');
    process.exit(1);
  }

  runMigrations(url)
    .then((applied) => {
      console.log(`Migrations complete. Applied ${applied.length} new migration(s).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
