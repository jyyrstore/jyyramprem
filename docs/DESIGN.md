# Jyy'R Amprem — UI/UX Specification

## 1. Tujuan

Revisi ini berfokus pada **UI/UX saja**. Backend, endpoint, Supabase Auth, provider API, rate-limit, quota, dan alur generate yang sudah berjalan tidak diubah.

Server `server.js` dipertahankan identik dengan baseline project.

## 2. Visual System

- Target utama: Android phone/tablet dengan feel modern seperti aplikasi native.
- Nuansa: hitam dengan sedikit ungu, bukan ungu penuh.
- Popup: abu-abu tua.
- Card: abu-abu muda gelap.
- Input: hitam pekat.
- Primary action: gradient ungu lembut.
- Success: hijau.
- Failed/error: merah.
- Limited/info: biru.
- Owner/warning: kuning.
- Border tipis, radius konsisten, shadow lembut.
- Button memiliki efek purple glow saat hover/focus/active.
- Active press memakai scale kecil agar terasa smooth.
- `prefers-reduced-motion` dihormati.

## 3. Branding

- Logo profil: `https://i.ibb.co.com/YFKtw7Pk/LOGO-PROFIL.png`
- Logo nama brand: `https://i.ibb.co.com/1GwwBB5W/LOGO-NAMA.png`
- Banner: `https://uploadin.web.id/f/jyybanner.mp4`
- Donate: `https://sociabuzz.com/ajirhs/tribe`

## 4. Login / Register

### Login
- Logo profil berada di tengah dan di luar card.
- Logo nama brand berada tepat di bawah logo profil dan tetap di luar card.
- Card login memiliki tab `Masuk` / `Daftar`.
- Field: Alight Motion Email.
- Password mempunyai toggle lihat/tutup.
- Lupa password tersedia.
- Copyright berada di luar card dan rata tengah.

### Register
Urutan field:
1. Username — contoh `jyyr26`.
2. Email — format `jyyramprem-xxxxxxxx@emalupe.com`.
3. Email / Gmail.
4. Code Verifikasi Email.
5. `Create Account` / `Verifikasi Email` mengikuti state proses.

Code verifikasi tetap memakai alur Supabase Auth yang sudah ada.

## 5. Home

### Header
- Backend pill berada di sisi kiri.
- Saat dipencet, pill melebar dan menampilkan `Online`.
- Status backend dapat berubah menjadi `Offline` bila health check gagal.
- Tombol Settings bulat berada di kanan.

### Account popup
Popup melayang berisi:
- avatar / nickname user;
- `Users Active` warna hijau;
- `Limited • 5` warna biru;
- tombol close bulat merah;
- Home;
- Dashboard;
- Setting;
- Donate;
- Riwayat;
- FAQ;
- Logout.

Dashboard dan Setting menggunakan navigasi langsung ke halaman masing-masing.

### Banner
- Video banner berbentuk persegi panjang dengan radius kecil.
- Glow ungu redup.
- Logo profil berada di tengah bawah banner dan sedikit overlap.

### Generate
- Password + lihat/tutup password.
- Random password.
- Generate Account.
- Success menampilkan email + password dan tombol salin.
- Failed menampilkan error merah.
- Limited ditampilkan sebagai state biru.
- Quota tetap berasal dari endpoint backend yang sudah ada.

### Content
- Account Benefits Alight Motion Premium.
- 3 langkah aktivasi.
- Security & Backend.
- Social & Community.
- Bantuan, Hubungi Kami, Informasi.
- Footer copyright.

Social URL:
- TikTok: `https://www.tiktok.com/@jyyr26`
- Instagram: `https://instagram.com/jyy_rsh`
- WhatsApp: `https://whatsapp.com/channel/0029VbCH7C0E50Uid8KYwG1f`
- Telegram: `https://t.me/JyyR_Mentahan`

## 6. Bottom Navigation

Bottom navigation:
- Home
- Dashboard
- Setting

Karakteristik:
- `position: fixed` sehingga tidak ikut scroll.
- Floating rounded container.
- Active item memiliki tonjolan setengah lingkaran di bagian atas.
- Glow ungu halus pada active/press.
- Tidak menutupi konten karena body diberi ruang bawah.

## 7. Dashboard

- Refresh bulat di kanan atas.
- Aktivasi Akun memakai grid metric yang responsif.
- Request Trend memakai bar chart 7 hari.
- Distribusi status memakai progress bars.
- Daily Log berupa list compact.
- Account History memakai table horizontal-scroll agar tidak merusak layout mobile.
- Semua angka berasal dari endpoint yang sudah ada; tidak ada angka backend baru yang dipalsukan.

## 8. Setting

- Refresh bulat di kanan atas.
- Avatar user berbentuk bulat dengan icon user.
- Username dan email rata tengah.
- Metadata: Status, Terdaftar Sejak, Login Terakhir.
- Tombol Home dan Logout.
- Quota Create Account.
- Statistik Account.
- Search email + filter status.
- History table dengan horizontal scroll.
- Pagination compact agar card tidak terlalu panjang.

## 9. Owner

Tab dibuat horizontal-scroll sehingga tidak memanjangkan halaman:
- Statistik
- Member
- Broadcast
- Notifikasi
- Security
- Sistem

### Statistik
- Grafik Account 7 Day.
- Bar chart.
- Data berdasarkan `created_at` yang dapat dibaca oleh akun.
- Perbandingan hari ini, seminggu, sebulan.

### Member
- Search.
- Member row compact.
- Detail / Suspend / Ban / Unban sebagai UI contract.
- Pagination setelah daftar panjang.

### Broadcast
- Form judul/pesan.
- Riwayat broadcast.
- Delete bulat di kanan atas card.
- Edit bulat di kanan bawah card.

### Notifikasi
- Member Message UI.
- FAQ.
- Help Center.
- Fitur yang belum memiliki backend contract tetap disabled agar tidak mengganggu sistem yang sudah benar.

### Security
- Daftar Owner/Admin.
- Login Activity.
- Pagination compact.

### Sistem
- Open Web.
- Maintenance Mode.
- Maintenance notice.
- Health: Supabase, Auth, Storage, Database, Apikey.

## 10. Responsive Rules

- Desktop/tablet: max content width sekitar 920px.
- Tablet: metric memakai 4 kolom bila ruang mencukupi.
- Mobile: metric otomatis turun menjadi 2 kolom, lalu 1 kolom pada layar sangat kecil.
- Table tidak dipaksa mengecil; menggunakan horizontal scrolling.
- Owner tabs menggunakan horizontal scrolling.
- Bottom nav selalu fixed.
- Tidak memakai dependency UI eksternal.

## 11. Compatibility / Non-Breaking Rules

Tidak boleh mengubah:
- `server.js`;
- Supabase service-role handling;
- Supabase publishable key flow;
- `/api/config`;
- `/api/health`;
- `/api/usage`;
- `/api/accounts`;
- `/api/generate`;
- Supabase Auth flow di `auth-client.js`;
- provider API secret handling;
- rate limit;
- local daily limit.

Perubahan UI menggunakan file HTML/CSS/JS frontend dan tidak memindahkan secret ke browser.
