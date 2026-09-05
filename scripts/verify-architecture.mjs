import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

const routeDir = path.join(root, "api", "routes");
const middlewareDir = path.join(root, "api", "middleware");
const configDir = path.join(root, "lib", "config");
const repoDir = path.join(root, "lib", "repositories");
const supabaseDir = path.join(root, "lib", "supabase");
const ownerDir = path.join(root, "public", "js", "owner");

const required = [
  "server.js",
  "api/routes/auth.routes.js",
  "api/routes/member.routes.js",
  "api/routes/owner.routes.js",
  "api/routes/provider.routes.js",
  "api/routes/release.routes.js",
  "api/routes/portal-token.routes.js",
  "api/routes/public.routes.js",
  "api/middleware/auth.middleware.js",
  "api/middleware/owner.middleware.js",
  "api/middleware/rate-limit.middleware.js",
  "api/middleware/error.middleware.js",
  "lib/config/env.js",
  "lib/config/app.config.js",
  "lib/config/security.config.js",
  "lib/repositories/supabase.repository.js",
  "lib/supabase/client.js",
  "lib/supabase/admin-client.js",
  "public/js/owner.js",
];

const missing = required.filter((file) => !exists(file));
const serverLines = read("server.js").split("\n").length;
const ownerLines = read("public/js/owner.js").split("\n").length;
const routeFiles = fs.readdirSync(routeDir).filter((file) => file.endsWith(".js")).sort();
const middlewareFiles = fs.readdirSync(middlewareDir).filter((file) => file.endsWith(".js")).sort();
const configFiles = fs.readdirSync(configDir).filter((file) => file.endsWith(".js")).sort();
const repositoryFiles = fs.readdirSync(repoDir).filter((file) => file.endsWith(".js")).sort();
const supabaseFiles = fs.readdirSync(supabaseDir).flatMap((entry) => {
  const p = path.join(supabaseDir, entry);
  return fs.statSync(p).isDirectory() ? fs.readdirSync(p).map((f) => `${entry}/${f}`) : [entry];
}).filter((file) => file.endsWith(".js")).sort();
const ownerFeatureFiles = fs.readdirSync(ownerDir).filter((file) => file.endsWith(".js")).sort();

const routeText = routeFiles.map((file) => read(`api/routes/${file}`)).join("\n");
const directSupabaseDataApi = /supabase\s*\.\s*(?:from|rpc|storage\s*\.\s*from)\s*\(/s.test(routeText);
const packageUnchangedByLock = exists("package-lock.json") && exists("package.json");

const result = {
  ok: missing.length === 0 && serverLines <= 500 && !directSupabaseDataApi,
  checks: {
    requiredFiles: missing.length === 0,
    serverCompositionRoot: serverLines <= 500,
    repositoryBoundaryInRoutes: !directSupabaseDataApi,
    packageManifestPresent: packageUnchangedByLock,
    pwaPresent: exists("public/manifest.webmanifest") && exists("public/service-worker.js"),
    migrationsPresent: exists("supabase/migrations"),
  },
  metrics: {
    serverLines,
    ownerBootstrapLines: ownerLines,
    routeFiles,
    middlewareFiles,
    configFiles,
    repositoryFiles,
    supabaseFiles,
    ownerFeatureFiles,
  },
  missing,
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
