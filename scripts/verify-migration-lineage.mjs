import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationDir = path.join(root, 'supabase', 'migrations');
const stateFile = path.join(root, 'docs', 'migration', 'MIGRATION_RECONCILIATION_STATE.json');
const strategyFile = path.join(root, 'docs', 'migration', 'CANONICAL_MIGRATION_STRATEGY.md');

const fail = (message) => {
  console.error(`MIGRATION_LINEAGE_FAIL: ${message}`);
  process.exit(1);
};

if (!fs.existsSync(migrationDir)) fail('supabase/migrations directory is missing');
if (!fs.existsSync(stateFile)) fail('MIGRATION_RECONCILIATION_STATE.json is missing');
if (!fs.existsSync(strategyFile)) fail('CANONICAL_MIGRATION_STRATEGY.md is missing');

const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const files = fs.readdirSync(migrationDir)
  .filter((name) => name.endsWith('.sql'))
  .sort();

const timestampPattern = /^(\d{14})_.*\.sql$/;
const versions = files.map((name) => {
  const match = name.match(timestampPattern);
  if (!match) fail(`invalid migration filename: ${name}`);
  return match[1];
});

const duplicates = versions.filter((v, i) => versions.indexOf(v) !== i);
if (duplicates.length) fail(`duplicate migration timestamps: ${[...new Set(duplicates)].join(', ')}`);

if (files.length !== state.repository.migration_file_count) {
  fail(`repository migration count drift: files=${files.length}, state=${state.repository.migration_file_count}`);
}

if (state.production.migration_count !== 80) {
  fail(`production baseline state must remain 80 until re-verified; found ${state.production.migration_count}`);
}

if (state.production.latest_version !== '20260904122452') {
  fail(`unexpected production latest version: ${state.production.latest_version}`);
}

if (state.deployment_policy.allow_direct_db_push_to_production !== false) {
  fail('direct production db push must remain disabled until reconciliation is complete');
}

if (state.deployment_policy.allow_history_rewrite !== false) {
  fail('production history rewrite must remain disabled');
}

if (state.deployment_policy.allow_edit_applied_migrations !== false) {
  fail('editing applied migrations must remain disabled');
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const scripts = packageJson.scripts || {};
if (!scripts['verify:migrations'] || scripts['verify:migrations'] !== 'node scripts/verify-migration-lineage.mjs') {
  fail('package.json must expose the canonical verify:migrations command');
}

console.log(JSON.stringify({
  ok: true,
  repositoryMigrationCount: files.length,
  duplicateTimestamps: [],
  productionMigrationCount: state.production.migration_count,
  productionLatestVersion: state.production.latest_version,
  directProductionPushAllowed: state.deployment_policy.allow_direct_db_push_to_production,
  status: state.status,
}, null, 2));
