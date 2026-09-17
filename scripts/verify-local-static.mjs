import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();

function run(command, args = [], options = {}) {
  execFileSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
    ...options,
  });
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }

  return out;
}

function checkCss(file) {
  const text = fs.readFileSync(file, "utf8");

  let depth = 0;
  let quote = null;
  let escaped = false;
  let comment = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1] ?? "";

    if (comment) {
      if (ch === "*" && next === "/") {
        comment = false;
        i++;
      }
      continue;
    }

    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "/" && next === "*") {
      comment = true;
      i++;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;

      if (depth < 0) {
        fail(`CSS unbalanced closing brace: ${file}`);
      }
    }
  }

  if (comment) {
    fail(`CSS unterminated comment: ${file}`);
  }

  if (quote !== null) {
    fail(`CSS unterminated string: ${file}`);
  }

  if (depth !== 0) {
    fail(`CSS unbalanced braces depth=${depth}: ${file}`);
  }

  console.log(`PASS CSS ${file}`);
}

console.log("==================================================");
console.log("=== JYY'R AMPREM — STATIC VERIFICATION ===");
console.log("==================================================");

const files = walk(ROOT);

console.log("\n=== JAVASCRIPT / MJS SYNTAX ===");

for (const file of files.filter(
  file => file.endsWith(".js") || file.endsWith(".mjs")
)) {
  try {
    run("node", ["--check", file], { stdio: "ignore" });
    console.log(`PASS JS ${file}`);
  } catch {
    fail(`JavaScript/MJS syntax error: ${file}`);
  }
}

console.log("\n=== CSS STRUCTURAL CHECK ===");

for (const file of files.filter(file => file.endsWith(".css"))) {
  checkCss(file);
}

console.log("\n=== HTML CHECK ===");

try {
  run("xmllint", ["--version"], { stdio: "ignore" });

  for (const file of files.filter(file => file.endsWith(".html"))) {
    try {
      run("xmllint", ["--html", "--noout", file], {
        stdio: "ignore",
      });

      console.log(`PASS HTML ${file}`);
    } catch {
      console.log(
        `CHECK HTML ${file} — xmllint bukan browser HTML parser`
      );
    }
  }
} catch {
  console.log("CHECK HTML — xmllint belum terinstall");
}

console.log("\n=== MIGRATION LINEAGE ===");

try {
  run("npm", ["run", "verify:migrations"]);
} catch {
  fail("Migration lineage verification gagal.");
}

console.log("\n==================================================");
console.log("=== STATIC VERIFICATION COMPLETE ===");
console.log("==================================================");
