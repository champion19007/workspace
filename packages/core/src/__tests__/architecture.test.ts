import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+['"]@workspace\/adapters.*['"]/,
  /from\s+['"].*adapters.*['"]/,
  /from\s+['"]@workspace\/web.*['"]/,
  /from\s+['"]@workspace\/api.*['"]/,
  /from\s+['"]@workspace\/worker.*['"]/,
  /from\s+['"]@workspace\/lambdas.*['"]/,
  /from\s+['"].*apps\/.*['"]/,
  /from\s+['"]@aws-sdk.*['"]/,
  /from\s+['"]aws-sdk.*['"]/,
  /from\s+['"]@supabase.*['"]/,
  /from\s+['"]@anthropic-ai.*['"]/,
  /from\s+['"]pg-boss.*['"]/,
];

function scanFiles(dir: string, fileList: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') {
        scanFiles(fullPath, fileList);
      }
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

export function checkSourceForForbiddenImports(content: string): string[] {
  const violations: string[] = [];
  for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
    if (pattern.test(content)) {
      violations.push(`Matches forbidden pattern: ${pattern.toString()}`);
    }
  }
  return violations;
}

describe('Core Module Architecture Boundary Rules', () => {
  it('strictly forbids packages/core from importing adapters, apps, or cloud SDKs', () => {
    const coreSrcDir = path.resolve(__dirname, '..');
    const sourceFiles = scanFiles(coreSrcDir);

    expect(sourceFiles.length).toBeGreaterThan(0);

    const allViolations: { file: string; violations: string[] }[] = [];

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const violations = checkSourceForForbiddenImports(content);
      if (violations.length > 0) {
        allViolations.push({ file, violations });
      }
    }

    expect(allViolations).toEqual([]);
  });

  it('boundary checker correctly detects and fails on illegal imports', () => {
    const illegalSamples = [
      `import { SqsQueue } from '@workspace/adapters/sqs';`,
      `import { S3Client } from '@aws-sdk/client-s3';`,
      `import { createClient } from '@supabase/supabase-js';`,
      `import Anthropic from '@anthropic-ai/sdk';`,
      `import PgBoss from 'pg-boss';`,
      `import { fastifyApp } from '../../../apps/api/index';`,
    ];

    for (const sample of illegalSamples) {
      const violations = checkSourceForForbiddenImports(sample);
      expect(violations.length).toBeGreaterThan(0);
    }
  });
});
