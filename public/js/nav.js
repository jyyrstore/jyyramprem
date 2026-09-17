(function () {
  const LOGO = 'https://i.ibb.co.com/YFKtw7Pk/LOGO-PROFIL.png';
  const BRAND = 'https://i.ibb.co.com/1GwwBB5W/LOGO-NAMA.png';
  const DONATE = 'https://sociabuzz.com/ajirhs/tribe';
  const APP_NAME = "Jyy'R Amprem";

  const socials = [
    [
      'TikTok',
      'https://www.tiktok.com/@jyyr26',
      'https://cdn-icons-png.flaticon.com/512/3046/3046121.png'
    ],
    [
      'Instagram',
      'https://instagram.com/jyy_rsh',
      'https://cdn-icons-png.flaticon.com/512/2111/2111463.png'
    ],
    [
      'WhatsApp',
      'https://whatsapp.com/channel/0029VbCH7C0E50Uid8KYwG1f',
      'https://cdn-icons-png.flaticon.com/512/733/733585.png'
    ],
    [
      'Telegram',
      'https://t.me/JyyR_Mentahan',
      'https://cdn-icons-png.flaticon.com/512/2111/2111646.png'
    ]
  ];

  const q = (selector) => document.querySelector(selector);

  let deferredInstallPrompt = null;
  let installPromptWaiters = [];
  let installAttemptInProgress = false;

  /*
   * Register service worker as early as possible.
   * This helps Chrome/Android complete PWA installability checks.
   */
  const appShellReady = 'serviceWorker' in navigator
    ? navigator.serviceWorker
        .register('/service-worker.js', { scope: '/' })
        .catch((error) => {
          console.warn('Service worker registration failed', error);
          return null;
        })
    : Promise.resolve(null);

  /*
   * Capture the browser's native PWA install prompt.
   */
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();

    deferredInstallPrompt = event;

    installPromptWaiters
      .splice(0)
      .forEach((resolve) => resolve(event));
  });

  /*
   * Detect successful app installation.
   */
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    setInstallLabel('installed');
  });

  /*
   * Wait for beforeinstallprompt.
   */
  function waitForInstallPrompt(timeout = 2500) {
    if (deferredInstallPrompt) {
      return Promise.resolve(deferredInstallPrompt);
    }

    return new Promise((resolve) => {
      installPromptWaiters.push(resolve);

      window.setTimeout(() => {
        const index = installPromptWaiters.indexOf(resolve);

        if (index !== -1) {
          installPromptWaiters.splice(index, 1);
          resolve(null);
        }
      }, timeout);
    });
  }

  /*
   * Check whether the PWA is already installed.
   */
  function isInstalled() {
    return (
      window.matchMedia?.('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      document.referrer.startsWith('android-app://')
    );
  }

  /*
   * Change Download App button label.
   */
  function setInstallLabel(state) {
    const button = q('#downloadAppAction');

    if (!button) return;

    const label = button.querySelector('.menu-item-copy');

    if (label) {
      label.textContent =
        state === 'installed'
          ? 'App Terpasang'
          : 'Download App';
    }
  }

  /*
   * Main PWA installation handler.
   */
  async function installApp() {
    const button = q('#downloadAppAction');

    if (!button || installAttemptInProgress) return;

    installAttemptInProgress = true;

    button.disabled = true;
    button.setAttribute('aria-busy', 'true');

    const label = button.querySelector('.menu-item-copy');
    const originalLabel = label?.textContent || 'Download App';

    try {
      /*
       * Already installed.
       */
      if (isInstalled()) {
        setInstallLabel('installed');

        window.JYYRNotify?.show?.(
          `${APP_NAME} sudah terpasang di perangkat ini.`,
          'success',
          {
            duration: 2800,
            key: 'app-install'
          }
        );

        return;
      }

      /*
       * Wait for service worker.
       */
      await appShellReady;

      /*
       * Wait for browser install prompt.
       */
      const promptEvent = await waitForInstallPrompt(2500);

      /*
       * Native browser install dialog available.
       */
      if (promptEvent) {
        promptEvent.prompt();

        const choice = await promptEvent.userChoice;

        deferredInstallPrompt = null;

        if (choice?.outcome === 'accepted') {
          setInstallLabel('installed');
        }

        return;
      }

      /*
       * Browser does not provide native install prompt.
       * Show manual installation instructions.
       */
      const ua = navigator.userAgent || '';

      const isIOS = /iphone|ipad|ipod/i.test(ua);
      const isAndroid = /android/i.test(ua);

      const message = isIOS
        ? `Untuk memasang ${APP_NAME}, buka menu Bagikan lalu pilih "Tambah ke Layar Utama".`
        : isAndroid
          ? `Untuk memasang ${APP_NAME}, pilih menu browser ⋮ lalu tekan "Install app" atau "Tambahkan ke layar utama".`
          : `Browser belum memberikan dialog pemasangan. Gunakan menu browser "Install app" atau "Tambahkan ke layar utama" untuk memasang ${APP_NAME}.`;

      window.JYYRNotify?.show?.(
        message,
        'info',
        {
          title: 'Install App',
          duration: 6200,
          key: 'app-install'
        }
      );
    } catch (error) {
      console.error('PWA install failed', error);

      window.JYYRNotify?.show?.(
        `Pemasangan ${APP_NAME} belum dapat dimulai. Silakan gunakan menu Install App pada browser.`,
        'error',
        {
          title: 'Install App',
          duration: 5200,
          key: 'app-install'
        }
      );
    } finally {
      if (
        label &&
        label.textContent === 'Memasang…'
      ) {
        label.textContent = originalLabel;
      }

      button.disabled = false;
      button.removeAttribute('aria-busy');

      installAttemptInProgress = false;
    }
  }

  /*
   * Get current user's display name.
   */
  function userName(user) {
    return (
      user?.user_metadata?.username ||
      user?.user_metadata?.nickname ||
      user?.email?.split('@')[0] ||
      'User'
    );
  }

  /*
   * Get current session.
   */
  async function session() {
    return window.AMAuth?.getSession() || null;
  }

  /*
   * Initialize authenticated page.
   */
  async function init() {
    const page = document.body.dataset.page || '';
    if (document.body.dataset.jyyrNavInitializedFor === page) return null;
    document.body.dataset.jyyrNavInitializedFor = page;
    const s = await session();

    if (!s) {
      window.JYYRApp?.navigate("login");
      return null;
    }

    const user =
      s.user ||
      await window.AMAuth.getUser();

    /*
     * User information.
     */
    document
      .querySelectorAll('[data-user-name]')
      .forEach((element) => {
        element.textContent = userName(user);
      });

    document
      .querySelectorAll('[data-user-email]')
      .forEach((element) => {
        element.textContent = user?.email || '-';
      });

    const avatar = q('[data-user-avatar]');

    if (avatar) {
      avatar.src = LOGO;
    }

    /*
     * Backend status elements.
     */
    const backend = q('#backendPill');
    const backendIcon = q('#backendIcon');
    const backendLabel = q('#backendLabel');
    const popupState = q('#popupBackendState');
    const health = q('#healthStatus');

    function applyBackendState(online) {
      const label = online
        ? 'Online'
        : 'Offline';

      if (backendIcon) {
        backendIcon.src = online
          ? '/assets/Icon/Backend-Online.png'
          : '/assets/Icon/Backend-ofline.png';
      }

      if (backendLabel) {
        backendLabel.textContent = label;
      }

      if (backend) {
        backend.classList.toggle('online', online);
        backend.classList.toggle('offline', !online);

        backend.title = online
          ? 'Backend aktif'
          : 'Backend offline';

        backend.setAttribute(
          'aria-label',
          label
        );
      }

      if (popupState) {
        popupState.classList.toggle(
          'offline',
          !online
        );

        popupState.innerHTML =
          `<span class="state-dot"></span> ${label}`;
      }

      if (health) {
        health.textContent = online
          ? 'Online'
          : 'Offline';

        health.className =
          `badge ${online ? 'green' : 'red'}`;
      }
    }

    /*
     * Backend health check.
     */
    async function healthCheck() {
      try {
        const response = await window.JYYRNet.fetchWithTimeout('/api/health', { cache: 'no-store' }, 5000);
        const data = await response.json().catch(() => ({}));
        applyBackendState(response.ok && data.ok === true);
      } catch {
        applyBackendState(false);
      }
    }

    /*
     * Open / close account popup.
     */
    q('#settingsBtn')?.addEventListener(
      'click',
      () => {
        const popup = q('#accountPopup');

        if (!popup) return;

        const open =
          !popup.classList.contains('show');

        popup.classList.toggle(
          'show',
          open
        );

        q('#settingsBtn')?.setAttribute(
          'aria-expanded',
          String(open)
        );

        popup.setAttribute(
          'aria-hidden',
          String(!open)
        );
      }
    );

    /*
     * Close popup button.
     */
    q('#closePopup')?.addEventListener(
      'click',
      () => {
        const popup = q('#accountPopup');

        popup?.classList.remove('show');

        q('#settingsBtn')?.setAttribute(
          'aria-expanded',
          'false'
        );

        popup?.setAttribute(
          'aria-hidden',
          'true'
        );
      }
    );

    /*
     * Close popup when clicking outside.
     */
    document.addEventListener(
      'click',
      (event) => {
        const popup = q('#accountPopup');

        if (
          popup?.classList.contains('show') &&
          !popup.contains(event.target) &&
          !q('#settingsBtn')?.contains(event.target)
        ) {
          popup.classList.remove('show');

          q('#settingsBtn')?.setAttribute(
            'aria-expanded',
            'false'
          );

          popup.setAttribute(
            'aria-hidden',
            'true'
          );
        }
      }
    );

    /*
     * Logout.
     */
    q('#logoutAction')?.addEventListener(
      'click',
      async () => {
        await window.AMAuth.signOut();
        window.JYYRApp?.navigate("login");
      }
    );

    /*
     * Download App.
     */
    q('#downloadAppAction')?.addEventListener(
      'click',
      () => { window.JYYRApp?.navigate("app"); }
    );

    /*
     * Donate.
     */
    q('#donateAction')?.addEventListener(
      'click',
      () => {
        window.open(
          DONATE,
          '_blank',
          'noopener,noreferrer'
        );
      }
    );

    /*
     * Refresh page.
     */
    q('#refreshPage')?.addEventListener(
      'click',
      () => location.reload()
    );

    /*
     * Service worker registration is background infrastructure.
     * It must never block first render or the global boot loader.
     */

    /*
     * Initial Download App label.
     */
    setInstallLabel(
      isInstalled()
        ? 'installed'
        : 'download'
    );

    /*
     * Initial backend check.
     */
    await healthCheck();

    /*
     * Check backend every 30 seconds.
     */
    setInterval(
      healthCheck,
      30000
    );

    return user;
  }

  /*
   * Render social media links.
   */
  function renderSocials() {
    const host = q('#socialLinks');

    if (!host) return;

    host.innerHTML = socials
      .map(
        ([name, url, icon]) => `
          <a
            class="social"
            href="${url}"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="${name}"
          >
            <img
              src="${icon}"
              alt="${name}"
            >
          </a>
        `
      )
      .join('');
  }

  /**
 * Setup brand banner video.
 */
function setupBrandBanner() {
  const video = q('#brandBanner');

  if (!video) {
    return;
  }

  if (video.dataset.bannerReady === '1') {
    const attempt = video.play();

    if (
      attempt &&
      typeof attempt.catch === 'function'
    ) {
      attempt.catch(() => {});
    }

    return;
  }

  video.dataset.bannerReady = '1';

  video.autoplay = true;
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';

  const start = () => {
    const attempt = video.play();

    if (
      attempt &&
      typeof attempt.catch === 'function'
    ) {
      attempt.catch(() => {});
    }
  };

  if (video.readyState >= 2) {
    start();
  } else {
    video.addEventListener(
      'canplay',
      start,
      { once: true }
    );
  }
}

  /*
   * Render shared page elements.
   */
  function renderShared() {
    document
      .querySelectorAll('[data-brand-logo]')
      .forEach((element) => {
        element.src = LOGO;
      });

    document
      .querySelectorAll('[data-brand-name-logo]')
      .forEach((element) => {
        element.src = BRAND;
      });

    setupBrandBanner();
    renderSocials();

    const currentPage =
      document.body.dataset.page || '';

    document
      .querySelectorAll('[data-nav]')
      .forEach((link) => {
        const target =
          link.dataset.nav || '';

        const active =
          target === currentPage;

        link.classList.toggle(
          'active',
          active
        );

        if (active) {
          link.setAttribute(
            'aria-current',
            'page'
          );
        } else {
          link.removeAttribute(
            'aria-current'
          );
        }
      });
  }

  /*
   * Public API.
   */
  window.JYYR = {
    init,
    renderShared,
    userName,
    LOGO,
    BRAND,
    DONATE
  };

  /*
   * Start application.
   */
  function boot() {
    renderShared();
    init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();