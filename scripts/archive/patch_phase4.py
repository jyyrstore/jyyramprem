from pathlib import Path

server = Path("server.js")

if not server.exists():
    raise SystemExit("ABORT: server.js tidak ditemukan.")

original = server.read_text(encoding="utf-8")
text = original

# --------------------------------------------------
# 1. Add production-only trust proxy after app creation
# --------------------------------------------------
trust = 'app.set("trust proxy", 1);'
app_anchor = "const app = express();"

if trust not in text:
    if text.count(app_anchor) != 1:
        raise SystemExit("ABORT: const app = express() tidak unik.")

    text = text.replace(
        app_anchor,
        '''const app = express();

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}''',
        1,
    )
    print("[PATCH] production-only trust proxy")
else:
    print("[OK] trust proxy sudah ada")

# --------------------------------------------------
# 2. Locate existing multiline express.static block
# --------------------------------------------------
if 'app.get("/app-intro.html"' in text:
    raise SystemExit(
        "ABORT: /app-intro.html sudah ada. "
        "Tidak melakukan patch parsial."
    )

marker = 'app.use(\n  express.static(\n    path.join(__dirname, "public"),'

static_start = text.find(marker)

if static_start == -1:
    raise SystemExit(
        "ABORT: express.static(public) tidak ditemukan "
        "dengan struktur aktual repository."
    )

# Find closing parenthesis of outer app.use(...)
open_paren = text.find("(", static_start)
depth = 0
static_end = None

for i in range(open_paren, len(text)):
    if text[i] == "(":
        depth += 1
    elif text[i] == ")":
        depth -= 1
        if depth == 0:
            static_end = i + 1
            break

if static_end is None:
    raise SystemExit("ABORT: akhir static middleware tidak ditemukan.")

if text[static_end:static_end + 1] == ";":
    static_end += 1

print("[OK] express.static(public) ditemukan")

# --------------------------------------------------
# 3. Insert canonical PWA routes
# --------------------------------------------------
routes = r'''
// PWA root assets live outside the public static root.
// Keep existing file locations and expose canonical URLs.
app.get("/app-intro.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "html", "app-intro.html"));
});

app.get("/manifest.webmanifest", (req, res) => {
  res.sendFile(path.join(__dirname, "manifest.webmanifest"));
});

app.get("/service-worker.js", (req, res) => {
  res.sendFile(path.join(__dirname, "service-worker.js"));
});
'''

text = text[:static_end] + "\n" + routes + text[static_end:]

# --------------------------------------------------
# 4. Full pre-write verification
# --------------------------------------------------
assert text.count('app.set("trust proxy", 1);') == 1
assert text.count('app.get("/app-intro.html"') == 1
assert text.count('app.get("/manifest.webmanifest"') == 1
assert text.count('app.get("/service-worker.js"') == 1

# Confirm important original structures survived.
for required in [
    'app.use(\n  express.static(',
    'path.join(__dirname, "public")',
    'app.disable("x-powered-by");',
]:
    if required not in text:
        raise SystemExit(
            f"ABORT: struktur original hilang: {required}"
        )

# --------------------------------------------------
# 5. Write temporary file, verify, then replace
# --------------------------------------------------
tmp = server.with_name("server.js.phase4.tmp")

tmp.write_text(text, encoding="utf-8")

check = tmp.read_text(encoding="utf-8")

for required in [
    'app.set("trust proxy", 1);',
    'app.get("/app-intro.html"',
    'app.get("/manifest.webmanifest"',
    'app.get("/service-worker.js"',
]:
    if required not in check:
        tmp.unlink(missing_ok=True)
        raise SystemExit(
            f"ABORT: temporary verification gagal: {required}"
        )

tmp.replace(server)

print("[DONE] server.js berhasil dipatch secara atomic.")
print("[VERIFY] trust proxy = 1")
print("[VERIFY] /app-intro.html = 1")
print("[VERIFY] /manifest.webmanifest = 1")
print("[VERIFY] /service-worker.js = 1")
