import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const removedArtifacts = [
  "docs/JYYR_AMPREM_REFACTOR_REPORT.md",
  "docs/JYYR_AMPREM_REFACTOR_REPORT.json",
  "RECOVERY_PATCH.diff",
  "public/assets/Icon/Alight-Motion.png",
  "public/assets/Icon/Costumer-servis.png",
  "public/assets/Icon/Situs-1.png",
  "public/assets/Icon/Tanggal.png",
  "public/assets/Icon/ban-user.png",
  "public/assets/Icon/broadcast-of.png",
  "public/assets/Icon/cari-email.png",
  "public/assets/Icon/suspend-user.png",
];

test("verified obsolete artifacts remain removed", () => {
  for (const relative of removedArtifacts) {
    assert.equal(fs.existsSync(path.join(root, relative)), false, `obsolete artifact restored: ${relative}`);
  }
});

test("removed-file register stays synchronized", () => {
  const register = fs.readFileSync(path.join(root, "docs/REMOVED_FILES.txt"), "utf8");
  for (const relative of [
    "docs/JYYR_AMPREM_REFACTOR_REPORT.md",
    "docs/JYYR_AMPREM_REFACTOR_REPORT.json",
  ]) {
    assert.match(register, new RegExp(relative.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")));
    assert.equal(fs.existsSync(path.join(root, relative)), false);
  }
});

test("/health keeps a single handler and disables caching", () => {
  const source = fs.readFileSync(path.join(root, "api/routes/public.routes.js"), "utf8");
  assert.match(source, /const healthHandler = async/);
  assert.match(source, /res\.setHeader\("Cache-Control", "no-store, max-age=0"\);/);
  assert.match(source, /app\.get\("\/api\/health", healthHandler\);/);
  assert.match(source, /app\.get\("\/health", healthHandler\);/);
});


test("public tree contains no rollback/backup artifacts", () => {
  const forbidden = /(\.bak(?:$|[.-])|\.backup(?:$|[.-])|\.old$|\.tmp$|\.orig$|before-safe-rollback|token-.*backup|bullet-state-backup|final-token-backup|aurora-backup)/i;
  const walk = (dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else out.push(full);
    }
    return out;
  };
  const files = walk(path.join(root, "public"));
  const offenders = files.filter((file) => forbidden.test(path.relative(root, file)));
  assert.deepEqual(offenders, []);
});

test("obsolete app-intro route is not registered", () => {
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.doesNotMatch(server, /app\.get\(["']\/app-intro\.html/);
});
