-- Workspace v1 Local PostgreSQL Initialization Script
-- Installs required extensions for multi-tenancy, tree hierarchies, citext emails, and vector search

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "ltree";

-- Try creating vector extension if pgvector image is used; graceful notice if not
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS "vector";
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector extension not pre-installed in base image; install pgvector package for vector search';
END $$;

-- Verify installed extensions
SELECT extname, extversion FROM pg_extension;
