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

-- Runtime login roles (Stage 17b). LOCAL DEVELOPMENT PASSWORDS ONLY: in deployed environments these roles
-- are created by migration 0015 without a password and the password comes from the secret store.
-- The API/BFF connect as workspace_api (DATABASE_URL), the worker as workspace_worker (DATABASE_DIRECT_URL);
-- migrations run as the owner (DATABASE_MIGRATION_URL). Safe to re-run against an existing volume:
--   docker exec -i workspace-v1-postgres psql -U workspace_user -d workspace_dev < infra/docker/postgres/init.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workspace_api') THEN
    CREATE ROLE workspace_api LOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workspace_worker') THEN
    CREATE ROLE workspace_worker LOGIN NOINHERIT;
  END IF;
  ALTER ROLE workspace_api PASSWORD 'workspace_api_dev_password';
  ALTER ROLE workspace_worker PASSWORD 'workspace_worker_dev_password';
END $$;
