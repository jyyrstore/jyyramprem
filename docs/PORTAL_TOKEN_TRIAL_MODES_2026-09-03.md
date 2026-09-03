# Portal Access Token — Trial 15/30 Hari + Permanent

## Kontrak

Owner tetap memakai tombol `Generate Token`, tetapi memilih mode masa berlaku sebelum generate:

- `15 Hari` → expiry = waktu generate + 15 × 24 jam.
- `30 Hari` → expiry = waktu generate + 30 × 24 jam.
- `Permanent` → `expires_at = NULL`, sehingga grant tidak pernah kedaluwarsa.

Token menggunakan mekanisme existing: plaintext dibuat server-side, hash SHA-256 disimpan untuk verifikasi, dan encrypted token tetap disimpan untuk Owner history. Format token tetap 20 karakter hex.

## Akses user

`portal_has_access()` menjadi sumber kebenaran grant portal. Trial akan berhenti saat grant/token expiry tercapai. Permanent menggunakan expiry `NULL`.

Client portal melakukan pemeriksaan akses saat membuka Home, Dashboard, dan Setting. Bila akses sudah berakhir/tidak ada, session Auth di-sign-out dari browser lalu user dikembalikan ke `/login.html?token=required`.

Login normal tetap bekerja untuk user yang grant portal-nya masih aktif: setelah Auth, status portal diperiksa dan user langsung masuk ke `/home.html`.

## Compatibility

Migration ini tidak mencabut token aktif lama dan tidak mengubah token yang telah ada menjadi trial/permanent. Row lama tetap memakai `duration_mode = NULL` dan `expires_at` yang sudah tersimpan; history menampilkannya sebagai `Legacy`.

## Security

Perubahan tetap memakai service-role di server untuk operasi Owner. Plaintext token tidak masuk ke database sebagai plaintext. `duration_mode` divalidasi server-side dan database-level.
