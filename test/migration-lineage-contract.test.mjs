import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const migrationDir = path.join(root, 'supabase', 'migrations');
const state = JSON.parse(fs.readFileSync(path.join(root, 'docs/migration/MIGRATION_RECONCILIATION_STATE.json'), 'utf8'));
const strategy = fs.readFileSync(path.join(root, 'docs/migration/CANONICAL_MIGRATION_STRATEGY.md'), 'utf8');

const migrationFiles = fs.readdirSync(migrationDir).filter((n) => n.endsWith('.sql')).sort();

test('canonical migration strategy is present and production push is gated', () => {
  assert.match(strategy, /production migration ledger/i);
  assert.match(strategy, /do not run `supabase db push` against production/i);
  assert.equal(state.deployment_policy.allow_direct_db_push_to_production, false);
  assert.equal(state.deployment_policy.allow_history_rewrite, false);
});

test('repository migration inventory remains deterministic', () => {
  const versions = migrationFiles.map((name) => name.slice(0, 14));
  assert.equal(migrationFiles.length, state.repository.migration_file_count);
  assert.equal(new Set(versions).size, versions.length);
  assert.equal(state.production.migration_count, 80);
  assert.equal(state.production.latest_version, '20260904122452');
});

test('strategy explicitly treats production history as immutable', () => {
  assert.match(strategy, /Never rewrite production history/i);
  assert.match(strategy, /Do not recreate missing historical SQL from memory/i);
  assert.match(strategy, /Forward-only operation/i);
});
