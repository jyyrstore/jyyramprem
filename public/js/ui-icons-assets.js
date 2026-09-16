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
    download:     "Download-App.png",


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

    copy:         "salin.png",

    edit:         "edit-profil.png",


    photo:        "Profil-user.png",
    photoPlus:    "edit-profil.png",
    photoCancel:  "cancel.png",



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


    /* ---------- Home — Premium Benefits ---------- */

    homeNoWatermark:  "scurity.png",
    homeUnlimited:    "Refresh.png",
    homeHighRes:      "grafik.png",
    homeAdFree:       "lock-of.png",
    homeEffects:      "gif.png",
    homeAssets:       "diamond.png",
    homeTransitions:  "Tanda-Panah-Bawah.png",
    homeColor:        "grafik.png",
    homeFaster:       "Icon-jam.png",


    /* ---------- Home — Semantic Sections ---------- */

    homeSteps:         "Verifikasi.png",
homeIntroMail:     "e-mail.png",
    homeVerify:        "ceklis-2.png",
    homeGuide:         "Verifikasi.png",
    homeAccess:        "link.png",
    homeFaq:           "FAQ.png",
    homeReport:        "Peringatan.png",
    homeDonate:        "Donasi.png",
    homeTerms:         "Dukungan.png",
    homePrivacy:       "lock-of.png",
    homeDisclaimer:    "Peringatan.png",
    homeDmca:          "scurity.png",
    homeInfoTitle:    "Situs.png",


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
      Gunakan registry SVG untuk icon semantic yang tidak punya
      asset PNG canonical; category hanya menjadi fallback terakhir.
    */
    if (!map[name] && window.JYYR_ICONS?.[name]) return window.JYYR_ICONS[name];
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
        width="20"
        height="20"
        decoding="async"
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