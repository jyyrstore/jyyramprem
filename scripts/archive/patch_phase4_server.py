from pathlib import Path

SERVER = Path("server.js")

if not SERVER.exists():
    raise SystemExit("ERROR: server.js tidak ditemukan.")

text = SERVER.read_text(encoding="utf-8")

# 1. Production-only trust proxy
anchor = "const app = express();"
replacement = """const app = express();

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}"""

if 'app.set("trust proxy", 1);' not in text:
    if text.count(anchor) != 1:
        raise SystemExit("ABORT: anchor app creation tidak unik.")
    text = text.replace(anchor, replacement, 1)
    print("[PATCH] trust proxy ditambahkan.")
else:
    print("[OK] trust proxy sudah ada.")

# 2. Canonical PWA routes
if 'app.get("/app-intro.html"' not in text:
    marker = 'app.use(express.static(path.join(__dirname, "public"),'

    start = text.find(marker)
    if start == -1:
        raise SystemExit("ABORT: express.static(public) tidak ditemukan.")

    paren = text.find("(", start)
    depth = 0
    end = None

    for i in range(paren, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                end = i + 1
                break

    if end is None:
        raise SystemExit("ABORT: akhir express.static(...) tidak ditemukan.")

    if end < len(text) and text[end] == ";":
        end += 1
    if end < len(text) and text[end] == "\n":
        end += 1

    routes = """
// PWA root assets live outside the public static root.
app.get("/app-intro.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "html", "app-intro.html"));
});

app.get("/manifest.webmanifest", (req, res) => {
  res.sendFile(path.join(__dirname, "manifest.webmanifest"));
});

app.get("/service-worker.js", (req, res) => {
  res.sendFile(path.join(__dirname, "service-worker.js"));
});
"""

    text = text[:end] + "\n" + routes + "\n" + text[end:]
    print("[PATCH] tiga PWA routes ditambahkan.")
else:
    print("[OK] PWA routes sudah ada.")

# 3. Safety checks
checks = [
    'app.set("trust proxy", 1);',
    'app.get("/app-intro.html"',
    'app.get("/manifest.webmanifest"',
    'app.get("/service-worker.js"',
]

for check in checks:
    if check not in text:
        raise SystemExit(f"ABORT: verification gagal: {check}")

for route in [
    "/app-intro.html",
    "/manifest.webmanifest",
    "/service-worker.js",
]:
    if text.count(f'app.get("{route}"') != 1:
        raise SystemExit(f"ABORT: route {route} tidak unik.")

SERVER.write_text(text, encoding="utf-8")
print("[DONE] server.js berhasil diperbarui.")
