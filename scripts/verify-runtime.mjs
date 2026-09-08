import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const requiredFiles = [
  'server.js',
  'package.json',
  'package-lock.json',
  '.env.example',
  'public/index.html',
  'public/manifest.webmanifest',
  'public/service-worker.js',
  'public/css/app.css',
  'public/js/router.js',
  'public/js/app.js',
  'public/js/auth-client.js',
  'public/js/auth.js',
  'public/js/home.js',
  'public/js/dashboard.js',
  'public/js/setting.js',
  'public/js/owner.js',
  'public/js/reset-password.js',
  'public/js/help.js',
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
const routeFiles = fs.readdirSync(path.join(root, 'api', 'routes')).filter((name) => name.endsWith('.routes.js')).map((name) => path.join(root, 'api', 'routes', name));
const routeSource = routeFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const routeMatches = [...routeSource.matchAll(/app\.(?:get|post|patch|put|delete)\(\s*['"]([^'"]+)/g)].map((m) => m[1]);
const routes = new Set(routeMatches);
const apiRoutes = new Set(routeMatches.filter((route) => route.startsWith('/api/')));
const jsSourceForRpcs = [server, routeSource, fs.readFileSync(path.join(root, 'lib', 'runtime', 'app-runtime.js'), 'utf8')].join('\n');
const rpcNames = new Set([...jsSourceForRpcs.matchAll(/\.rpc\(\s*['"]([^'"]+)/g)].map((m) => m[1]));

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

const requiredPublicRoutes = ['/api/faq', '/api/help'];
const missingPublicRoutes = requiredPublicRoutes.filter((route) => !routes.has(route));
if (missingPublicRoutes.length) {
  console.error('MISSING_PUBLIC_HELP_ROUTES');
  missingPublicRoutes.forEach((route) => console.error(`- ${route}`));
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

const publicRoot = path.join(root, 'public');
const legacyPublicPages = [
  'app.html',
  path.join('html', 'index.html'),
  path.join('html', 'login.html'),
  path.join('html', 'home.html'),
  path.join('html', 'dashboard.html'),
  path.join('html', 'setting.html'),
  path.join('html', 'owner.html'),
  path.join('html', 'reset-password.html'),
  path.join('html', 'help.html'),
  path.join('html', 'app-intro.html'),
];
const legacyFilesPresent = legacyPublicPages.filter((file) => fs.existsSync(path.join(publicRoot, file)));
if (legacyFilesPresent.length) {
  console.error('LEGACY_PUBLIC_ENTRY_FILES_PRESENT');
  legacyFilesPresent.forEach((file) => console.error(`- public/${file.replaceAll(path.sep, '/')}`));
  process.exit(1);
}

const indexHtml = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');
const expectedViews = ['login', 'home', 'dashboard', 'setting', 'owner', 'app'];
for (const view of expectedViews) {
  if (!indexHtml.includes(`id="view-${view}"`) || !indexHtml.includes(`data-view="${view}"`)) {
    throw new Error(`Missing canonical frontend view: ${view}`);
  }
}
if (!/<script\s+src=["']\/js\/router\.js["']/.test(indexHtml)) throw new Error('index.html must load router.js');
if (!/<script\s+src=["']\/js\/auth-client\.js["']/.test(indexHtml)) throw new Error('index.html must load auth-client.js');
if (/\/public\/html\//.test(indexHtml) || /(?:href|src)=["']\/[^"']+\.html(?:[?#][^"']*)?["']/.test(indexHtml)) {
  throw new Error('index.html contains a legacy HTML entry reference');
}

const runtimeSurfaceFiles = [
  'public/index.html',
  'public/js/router.js',
  'public/js/auth-client.js',
  'public/js/auth.js',
  'public/js/home.js',
  'public/js/dashboard.js',
  'public/js/setting.js',
  'public/js/owner.js',
  'public/js/reset-password.js',
  'public/js/help.js',
  'public/js/nav.js',
  'public/js/ui-protection.js',
  'public/js/app.js',
  'public/manifest.webmanifest',
  'public/service-worker.js',
  'api/routes/release.routes.js',
  'vercel.json',
].filter((file) => fs.existsSync(path.join(root, file)));
const forbiddenRuntimeRefs = /(?:\/login\.html|\/home\.html|\/dashboard\.html|\/setting\.html|\/owner\.html|\/app\.html|\/help\.html|\/reset-password\.html|app-intro\.html)/g;
const forbiddenHits = [];
for (const file of runtimeSurfaceFiles) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  for (const match of text.matchAll(forbiddenRuntimeRefs)) forbiddenHits.push(`${file}:${match.index}:${match[0]}`);
}
if (forbiddenHits.length) {
  console.error('FORBIDDEN_LEGACY_RUNTIME_REFERENCES');
  forbiddenHits.forEach((hit) => console.error(`- ${hit}`));
  process.exit(1);
}

const legacyRedirectSource = fs.readFileSync(path.join(root, 'api/routes/public.routes.js'), 'utf8');
for (const [legacyPath, canonicalPath] of Object.entries({
  '/index.html': '/',
  '/login.html': '/login',
  '/home.html': '/',
  '/dashboard.html': '/dashboard',
  '/setting.html': '/setting',
  '/owner.html': '/owner',
  '/app.html': '/app',
})) {
  const pair = `"${legacyPath}": "${canonicalPath}"`;
  if (!legacyRedirectSource.includes(pair)) throw new Error(`Missing compatibility redirect: ${legacyPath} -> ${canonicalPath}`);
}
if (!/res\.redirect\(308,/.test(legacyRedirectSource)) throw new Error('Legacy page routes must redirect with 308');

console.log(JSON.stringify({
  ok: true,
  nodeRequirement: pkg.engines?.node || null,
  dependencyLockSync: true,
  requiredFiles: requiredFiles.length,
  jsFiles: jsFiles.length,
  routePathCount: routes.size,
  apiRouteHandlerCount: routeMatches.filter((route) => route.startsWith('/api/')).length,
  routeFiles: routeFiles.map((file) => path.relative(root, file)),
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
