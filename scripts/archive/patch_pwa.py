from pathlib import Path

server = Path("server.js")

if not server.exists():
    raise SystemExit("ABORT: server.js tidak ditemukan.")

original = server.read_text(encoding="utf-8")
text = original

# --------------------------------------------------
# 1. trust proxy
# --------------------------------------------------
trust = 'app.set("trust proxy", 1);'

if trust not in text:
    raise SystemExit(
        "ABORT: trust proxy belum ada. Jangan menebak state server.js."
    )

print("[OK] trust proxy ditemukan.")

# --------------------------------------------------
# 2. Locate the exact existing express.static block
# --------------------------------------------------
static_start = text.find("app.use(\n  express.static(")

if static_start == -1:
    raise SystemExit(
        "ABORT: bentuk express.static aktual tidak ditemukan."
    )

# Find the matching end of app.use(...), starting from the
# opening parenthesis after app.use.
app_open = text.find("(", static_start)
depth = 0
static_end = None

for i in range(app_open, len(text)):
    if text[i] == "(":
        depth += 1
    elif text[i] == ")":
        depth -= 1
        if depth == 0:
            static_end = i + 1
            break

if static_end is None:
    raise SystemExit(
        "ABORT: tidak dapat menentukan akhir express.static middleware."
    )

if text[static_end:static_end + 1] == ";":
    static_end += 1

print(
    f"[OK] express.static block ditemukan "
    f"(offset {static_start}:{static_end})."
)

# --------------------------------------------------
# 3. PWA routes
# --------------------------------------------------
routes = r'''
// PWA root assets live outside the public static root.
// Keep their existing locations and expose only canonical URLs.
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

existing_routes = [
    'app.get("/app-intro.html"',
    'app.get("/manifest.webmanifest"',
    'app.get("/service-worker.js"',
]

if any(route in text for route in existing_routes):
    raise SystemExit(
        "ABORT: salah satu PWA route sudah ada. "
        "Tidak melakukan perubahan parsial."
    )

# Insert immediately after static middleware.
text = (
    text[:static_end]
    + "\n"
    + routes
    + text[static_end:]
)

# --------------------------------------------------
# 4. Pre-write verification
# --------------------------------------------------
if text.count('app.set("trust proxy", 1);') != 1:
    raise SystemExit(
        "ABORT: trust proxy count tidak valid."
    )

for route in [
    "/app-intro.html",
    "/manifest.webmanifest",
    "/service-worker.js",
]:
    if text.count(f'app.get("{route}"') != 1:
        raise SystemExit(
            f"ABORT: route {route} count tidak valid."
        )

# Ensure the original content was preserved except for
# the intended route insertion.
if not text.startswith(original[:100]):
    raise SystemExit(
        "ABORT: unexpected file transformation detected."
    )

# --------------------------------------------------
# 5. Atomic-ish single write
# --------------------------------------------------
tmp = server.with_suffix(".js.phase4.tmp")
tmp.write_text(text, encoding="utf-8")

# Verify temporary result before replacing the real file.
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

print("[DONE] server.js berhasil dipatch.")
print("[VERIFY] trust proxy = 1")
print("[VERIFY] /app-intro.html route = 1")
print("[VERIFY] /manifest.webmanifest route = 1")
print("[VERIFY] /service-worker.js route = 1")
