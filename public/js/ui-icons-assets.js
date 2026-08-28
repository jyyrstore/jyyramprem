/* =========================================================
   JYY'R AMPREM — Asset-backed UI Icon Adapter
   ---------------------------------------------------------
   Non-login pages only.
   Login.html / login.css icon rendering tetap untouched.

   Cara mengganti icon:
   cukup ubah nama file di bagian ICON MAP.

   Contoh:
     shield: "scurity.png"

   menjadi:
     shield: "lock-of.png"
========================================================= */

(() => {

  /* =======================================================
     BASE PATH
  ======================================================= */

  const base = "/assets/Icon/";


  /* =======================================================
     ICON MAP
     -------------------------------------------------------
     Format:
       namaIcon: "nama-file.png"
  ======================================================= */

  const map = {

    /* ---------- Settings / General ---------- */

    settings:     "setting.png",
    settingsMenu: "menu.png",

    close:        "cancel.png",
    cancel:       "cancel.png",

    refresh:      "Refresh.png",


    /* ---------- Premium / Status ---------- */

    gift:         "gif.png",
    giftIcon:     "gif.png",
    giftIcon2:    "gif.png",

    package:      "diamond.png",
    packageIcon:  "diamond.png",
    packageIcon2: "diamond.png",

    crown:        "VIP.png",
    star:         "diamond.png",
    trophy:       "VIP.png",

    shield:       "scurity.png",
    check:        "ceklis-2.png",

    lock:         "lock-of.png",
    unlock:       "lock-open.png",


    /* ---------- Navigation ---------- */

    home:         "Home.png",
    dashboard:    "dasboard.png",

    category:     "menu.png",

    arrowRight:   "link.png",
    arrowDown:    "Tanda-Panah-Bawah.png",
    arrowUp:      "Tanda-Panah-Bawah.png",
    back:         "Tanda-Panah-Bawah.png",


    /* ---------- Account ---------- */

    user:         "Profil-user.png",
    users:        "cari-user.png",

    bell:         "bel.png",

    logout:       "Log-Out.png",
    logout2:      "Log-Out.png",


    /* ---------- Email / Input ---------- */

    mail:         "e-mail.png",

    eye:          "tampilkan-sandi.png",
    eyeOff:       "tutup-sandi.png",

    search:       "cari.png",


    /* ---------- Files / Actions ---------- */

    file:         "salin.png",
    copy:         "salin.png",

    edit:         "edit-profil.png",

    plus:         "link.png",

    photo:        "Profil-user.png",
    photoPlus:    "edit-profil.png",
    photoCancel:  "cancel.png",

    trash:        "cancel.png",


    /* ---------- Finance / Wallet ---------- */

    coin:         "diamond.png",
    cash:         "Donasi.png",

    deposit:      "Donasi.png",
    wallet:       "Donasi.png",

    card:         "diamond.png",


    /* ---------- Statistics / History ---------- */

    chart:        "grafik.png",
    receipt:      "Riwayat.png",


    /* ---------- Social / Community ---------- */

    store:        "Channel-Saluran.png",
    brandShopee:  "Channel-Saluran.png",

    broadcast:    "broadcast-on.png",
    message:      "Channel-Saluran.png",


    /* ---------- Help / Information ---------- */

    help:         "FAQ.png"

  };


  /* =======================================================
     ESCAPE HTML ATTRIBUTE
  ======================================================= */

  const esc = (value) => {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;");
  };


  /* =======================================================
     ASSET ICON RENDERER
  ======================================================= */

  window.assetIcon = function (
    name,
    className = "ui-icon"
  ) {

    /*
      Jika nama icon tidak ditemukan,
      gunakan category sebagai fallback.
    */

    const file = map[name] || map.category;


    /*
      Buat path asset.
    */

    const src =
      base +
      encodeURIComponent(file).replace(/%2F/g, "/");


    /*
      Return <img> icon.
    */

    return `
      <img
        class="${esc(className)} asset-ui-icon"
        src="${src}"
        alt=""
        aria-hidden="true"
        draggable="false"
      >
    `;
  };


  /* =======================================================
     GLOBAL ICON OVERRIDE
     -------------------------------------------------------
     Non-login pages menggunakan asset PNG.
     ======================================================= */

  window.icon = window.assetIcon;

})();