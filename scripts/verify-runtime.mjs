import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const requiredFiles = [
  'server.js',
  'package.json',
  'package-lock.json',
  '.env.example',
  'public/html/index.html',
  'public/html/login.html',
  'public/html/home.html',
  'public/html/dashboard.html',
  'public/html/setting.html',
  'public/html/owner.html',
  'public/html/reset-password.html',
  'public/js/auth-client.js',
  'public/js/auth.js',
  'public/js/home.js',
  'public/js/dashboard.js',
  'public/js/setting.js',
  'public/js/owner.js',
  'public/js/reset-password.js',
];

const missing = requiredFiles.filter((f) => !fs.existsSync(path.join(root, f)));
if (missing.length) {
  console.error('MISSING_FILES');
  for (const file of missing) console.error(`- ${file}`);
  process.exit(1);
}



function validateHttpUrl(name, value) {
  const raw = String(value || '').trim();
  if (!raw) return { ok: false, reason: 'missing' };
  let candidate = raw;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate) && /^[a-z0-9.-]+(?::\d+)?(?:\/.*)?$/i.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
      return { ok: false, reason: 'not-http-url' };
    }
    return { ok: true, normalized: url.toString().replace(/\/$/, '') };
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
}

function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const values = {};
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const exampleEnv = readEnvFile(path.join(root, '.env.example'));
const actualEnv = readEnvFile(path.join(root, '.env'));

const exampleSupabaseUrl = exampleEnv.SUPABASE_URL || '';
const exampleUrlCheck = validateHttpUrl('SUPABASE_URL', exampleSupabaseUrl);
if (!exampleUrlCheck.ok) {
  console.error(`INVALID_ENV_EXAMPLE_SUPABASE_URL: ${exampleUrlCheck.reason}`);
  process.exit(1);
}

const actualSupabaseUrl = actualEnv.SUPABASE_URL || process.env.SUPABASE_URL || '';
const actualUrlCheck = validateHttpUrl('SUPABASE_URL', actualSupabaseUrl);
let supabaseStatus = 'not_configured';
let supabaseReason = actualSupabaseUrl ? (actualUrlCheck.ok ? null : actualUrlCheck.reason) : 'missing SUPABASE_URL in .env';

if (actualUrlCheck.ok) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(actualUrlCheck.normalized, {
      method: 'GET',
      signal: controller.signal,
      headers: { accept: 'application/json' }
    });
    // A reachable Supabase endpoint may legitimately return 401/404 at its root.
    // Any HTTP response proves the configured host is reachable.
    supabaseStatus = 'connected';
    supabaseReason = null;
  } catch (error) {
    supabaseStatus = 'configured_but_unreachable';
    supabaseReason = error?.name === 'AbortError' ? 'connection-timeout' : 'network-error';
  } finally {
    clearTimeout(timeout);
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const locked = lock.packages?.['']?.dependencies || {};
for (const [name, version] of Object.entries(pkg.dependencies || {})) {
  if (locked[name] !== version) {
    console.error(`LOCK_MISMATCH ${name}: package=${version} lock=${locked[name]}`);
    process.exit(1);
  }
}

const jsFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) jsFiles.push(full);
  }
}
walk(path.join(root, 'public'));

const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const routeMatches = [...server.matchAll(/app\.(?:get|post|patch|put|delete)\(\s*['"]([^'"]+)/g)].map((m) => m[1]);
const routes = new Set(routeMatches);
const apiRoutes = new Set(routeMatches.filter((route) => route.startsWith('/api/')));
const rpcNames = new Set([...server.matchAll(/\.rpc\(\s*['"]([^'"]+)/g)].map((m) => m[1]));

const requiredOwnerRoutes = [
  '/api/owner/faq',
  '/api/owner/help',
  '/api/owner/login-activity',
  '/api/owner/maintenance',
  '/api/owner/broadcasts/:id/execute',
];
const missingOwnerRoutes = requiredOwnerRoutes.filter((route) => !routes.has(route));
if (missingOwnerRoutes.length) {
  console.error('MISSING_OWNER_ROUTES');
  missingOwnerRoutes.forEach((route) => console.error(`- ${route}`));
  process.exit(1);
}

const requiredOwnerRpcs = [
  'owner_list_faq', 'owner_create_faq', 'owner_update_faq', 'owner_delete_faq',
  'owner_list_help', 'owner_create_help', 'owner_update_help', 'owner_delete_help',
  'owner_list_login_activity', 'owner_get_system_settings', 'owner_set_maintenance',
  'owner_execute_broadcast',
];
const missingOwnerRpcs = requiredOwnerRpcs.filter((rpc) => !rpcNames.has(rpc));
if (missingOwnerRpcs.length) {
  console.error('MISSING_OWNER_RPCS_IN_RUNTIME');
  missingOwnerRpcs.forEach((rpc) => console.error(`- ${rpc}`));
  process.exit(1);
}

function assertBalancedCss(file) {
  let text = fs.readFileSync(file, 'utf8');
  text = text.replace(/\/\*[\s\S]*?\*\//g, (m) => '\n'.repeat((m.match(/\n/g) || []).length));
  text = text.replace(/\"(?:\\.|[^\"\\])*\"|\'(?:\\.|[^\'\\])*\'/g, '');
  const stack = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    for (const ch of lines[i]) {
      if (ch === '{') stack.push(i + 1);
      else if (ch === '}') {
        if (!stack.length) throw new Error(`Unbalanced CSS in ${path.relative(root, file)}: extra } at line ${i + 1}`);
        stack.pop();
      }
    }
  }
  if (stack.length) throw new Error(`Unbalanced CSS in ${path.relative(root, file)}: unclosed { at lines ${stack.join(', ')}`);
}

for (const css of ['public/css/home.css', 'public/css/login.css']) assertBalancedCss(path.join(root, css));

const localPages = ['index.html','login.html','home.html','dashboard.html','setting.html','owner.html','reset-password.html'];
const htmlDir = path.join(root, 'public', 'html');
for (const page of localPages) {
  if (!fs.existsSync(path.join(htmlDir, page))) throw new Error(`Missing page ${page}`);
}
for (const page of localPages) {
  const expected = page === 'index.html' ? '/' : `/${page}`;
  if (!routes.has(expected) && !(page === 'owner.html' && routes.has('/owner.html'))) {
    throw new Error(`Missing server page route ${expected}`);
  }
}

const unresolvedLocalRefs = [];
for (const file of fs.readdirSync(htmlDir).filter((x) => x.endsWith('.html'))) {
  const text = fs.readFileSync(path.join(htmlDir, file), 'utf8');
  for (const match of text.matchAll(/(?:src|href)=["'](\/(?:css|js)\/[^"']+)["']/g)) {
    const ref = match[1];
    const localPath = ref.split(/[?#]/, 1)[0];
    if (!fs.existsSync(path.join(root, 'public', localPath.slice(1)))) unresolvedLocalRefs.push(`${file}: ${ref}`);
  }
}
if (unresolvedLocalRefs.length) {
  console.error('BROKEN_LOCAL_REFS');
  unresolvedLocalRefs.forEach((x) => console.error(`- ${x}`));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  nodeRequirement: pkg.engines?.node || null,
  dependencyLockSync: true,
  requiredFiles: requiredFiles.length,
  jsFiles: jsFiles.length,
  routePathCount: routes.size,
  apiRouteHandlerCount: routeMatches.filter((route) => route.startsWith('/api/')).length,
  apiUniquePathCount: apiRoutes.size,
  rpcReferenceCount: rpcNames.size,
  localFrontendReferences: 'ok',
  supabaseEnvExampleUrl: exampleUrlCheck.normalized,
  supabase: {
    status: supabaseStatus,
    url: actualUrlCheck.ok ? actualUrlCheck.normalized : null,
    source: actualEnv.SUPABASE_URL ? '.env' : (process.env.SUPABASE_URL ? 'process.env' : null),
    reason: supabaseReason
  },
  note: 'URL configuration is checked locally. Live RPC/table existence still requires a connected Supabase project check.'
}, null, 2));
