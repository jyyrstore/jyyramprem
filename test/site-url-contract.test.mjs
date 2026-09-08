import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonical = "https://www.jyyramprem.my.id";
const forbidden = [
  ["http", "localhost:3000"].join("://"),
  ["https", "jyyramprem.vercel.app"].join("://"),
  ["https", "github.com/jyyrstore/jyyramprem"].join("://"),
];

function collectTextFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTextFiles(full));
    else if (!/\.(?:png|jpe?g|webp|gif|mp4|ttf|otf|woff2?)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

test("canonical website URL contract is preserved in the single entry point", () => {
  const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
  assert.match(html, new RegExp(`href=["']${canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`));
});

test("forbidden legacy project URLs are absent from the repository text surface", () => {
  const hits = [];
  for (const file of collectTextFiles(root)) {
    if (path.relative(root, file) === "test/site-url-contract.test.mjs") continue;
    const text = fs.readFileSync(file, "utf8");
    for (const url of forbidden) {
      if (text.includes(url)) hits.push(`${path.relative(root, file)} -> ${url}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("member provider flow imports every non-runtime helper and endpoint constant it executes", () => {
  const source = fs.readFileSync(path.join(root, "api/routes/member.routes.js"), "utf8");
  assert.match(source, /decodeJwtPayloadSafe/);
  assert.match(source, /extractProviderEmail/);
  assert.match(source, /normalizeMagicLink/);
  assert.match(source, /PROVIDER_APPLY_PREMIUM_PATH/);
  assert.match(source, /PROVIDER_SEND_MAGICLINK_PATH/);
  assert.match(source, /PROVIDER_VERIFY_ACCOUNT_PATH/);
});

test("provider diagnostic route imports every runtime symbol it executes", () => {
  const source = fs.readFileSync(path.join(root, "api/routes/provider.routes.js"), "utf8");
  assert.match(source, /normalizeProviderDiagnosticEvent/);
  assert.match(source, /providerDiagnosticPublicError/);
  assert.match(source, /PROVIDER_DIAGNOSTIC_SECRET/);
  assert.match(source, /PROVIDER_DELIVERY_WEBHOOK_ENABLED/);
});
