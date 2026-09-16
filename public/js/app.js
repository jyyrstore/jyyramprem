document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  /* =========================================================
     HELPERS
     ========================================================= */

  const $ = (selector) => document.querySelector(selector);

  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (match) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[match]
    );


    const fmtTop = (bytes) => {
      const n = Number(bytes);

      if (!Number.isFinite(n) || n <= 0) {
        return '—';
      }

      return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    };


    const fmtInfo = (bytes) => {
      const n = Number(bytes);

      if (!Number.isFinite(n) || n <= 0) {
        return '—';
      }

      return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    };


    const dateParts = (value) => {
      if (!value) {
        return {
          d: '—',
          m: '',
          y: ''
        };
      }

      const dt = new Date(value);

      if (Number.isNaN(dt.getTime())) {
        return {
          d: '—',
          m: '',
          y: ''
        };
      }

      const months = [
        'jan',
        'feb',
        'mar',
        'apr',
        'mei',
        'jun',
        'jul',
        'agu',
        'sep',
        'okt',
        'nov',
        'des'
      ];

      return {
        d: String(dt.getDate())
          .padStart(2, '0')
          .replace(/^0/, ''),

        m: months[dt.getMonth()],

        y: String(dt.getFullYear())
      };
    };


    const formatSha = (value) => {
      const sha = String(value || '—');

      if (sha.length === 64) {
        return `
          ${esc(sha.slice(0, 33))}
          <br>
          ${esc(sha.slice(33))}
        `;
      }

      return esc(sha);
    };


    const normalizeChips = (items) => {
      const defaults = [
        '#Generator Alight Motion',
        'Effect Premium'
      ];

      const cleaned = Array.isArray(items)
        ? items
            .map((item) => String(item ?? '').trim())
            .filter(Boolean)
        : [];

      return cleaned.slice(0, 2).length === 2
        ? cleaned.slice(0, 2)
        : defaults;
    };


    /* =========================================================
       RENDER LATEST RELEASE
       ========================================================= */

    function renderLatest(release) {
      const parts = dateParts(release.published_at);

      const chips = [
        '#Generator Alight Motion',
        'Effect Premium'
      ];

      $('#latest').outerHTML = `
        <div class="app-summary">

          <img
            class="app-icon"
            src="/assets/Foto/app_icon.png"
            alt="Jyy'R Amprem"
          >

          <div class="app-copy">

            <h1
              id="releaseTitle"
              class="app-name"
            >
              Jyy'R Amprem
            </h1>

            <div class="app-version">
              V ${esc(release.version)}
            </div>

            <div class="app-size">
              ${fmtTop(release.file_size_bytes)}
            </div>

            <div class="latest-badge">
              Terbaru
            </div>

          </div>

        </div>


        <div class="action-row">

          <a
            class="action-button download"
            href="${esc(release.download_url)}"
            download
            aria-label="Download APK Jyy'R Amprem"
          >
            Download
          </a>

          <button
            class="action-button center"
            type="button"
            id="shareAppButton"
            aria-label="Bagikan Jyy'R Amprem"
          >
            Bagikan
          </button>

        </div>


        <div class="chip-row">

          <span class="chip">
            ${esc(chips[0])}
          </span>

          <span class="chip">
            ${esc(chips[1])}
          </span>

        </div>
      `;


      $('#info').innerHTML = `
        <div class="info-grid">

          <div class="info-item">
            <h3 class="info-label">
              Version
            </h3>

            <p class="info-value">
              ${esc(release.version)}
            </p>
          </div>


          <div class="info-item">
            <h3 class="info-label">
              Version Code
            </h3>

            <p class="info-value">
              ${esc(release.version_code)}
            </p>
          </div>


          <div class="info-item">
            <h3 class="info-label">
              Rilis
            </h3>

            <p class="info-value">
              ${esc(parts.d)},${esc(parts.m)},${esc(parts.y)}
            </p>
          </div>


          <div class="info-item">
            <h3 class="info-label">
              Ukuran
            </h3>

            <p class="info-value">
              ${fmtInfo(release.file_size_bytes)}
            </p>
          </div>


          <div class="info-item sha">

            <h3 class="info-label">
              SHA-256
            </h3>

            <p class="info-value">
              ${formatSha(release.sha256)}
            </p>

          </div>

        </div>
      `;
    }


    /* =========================================================
       RENDER RELEASE HISTORY
       ========================================================= */

    function renderHistory(rows) {
      if (!Array.isArray(rows) || !rows.length) {
        $('#history').innerHTML = `
          <div class="status">
            Belum ada riwayat release.
          </div>
        `;

        return;
      }


      $('#history').innerHTML = rows
        .map(
          (release) => `
            <article class="history-card">

              <div class="history-row">

                <strong>
                  V ${esc(release.version)}
                </strong>

                <span>
                  ${esc(release.release_channel || 'stable')}
                </span>

              </div>


              <div
                class="history-row"
                style="margin-top:7px"
              >

                <span>
                  Version Code ${esc(release.version_code)}
                </span>

                <span>
                  ${fmtInfo(release.file_size_bytes)}
                </span>

              </div>

            </article>
          `
        )
        .join('');
    }


    /* =========================================================
       ACCORDION
       ========================================================= */

    const setupSectionToggle = (
      toggle,
      body,
      label
    ) => {
      if (!toggle || !body) {
        return;
      }

      const header = toggle.closest('.section-header');


      const setState = (open) => {
        toggle.setAttribute(
          'aria-expanded',
          String(open)
        );

        toggle.setAttribute(
          'aria-label',
          `${open ? 'Tutup' : 'Buka'} ${label}`
        );

        body.hidden = !open;

        header?.classList.toggle(
          'is-collapsed',
          !open
        );
      };


      toggle.addEventListener('click', () => {
        const open =
          toggle.getAttribute('aria-expanded') !== 'true';

        setState(open);
      });


      setState(
        toggle.getAttribute('aria-expanded') === 'true'
      );
    };


    setupSectionToggle(
      document.querySelector(
        '[data-section-toggle="support"]'
      ),
      $('#supportBody'),
      'Dukungan Aplikasi'
    );


    setupSectionToggle(
      document.querySelector(
        '[data-section-toggle="info"]'
      ),
      $('#info'),
      'Informasi Aplikasi'
    );


    /* =========================================================
       SHARE APP
       ========================================================= */

    document.addEventListener('click', async (event) => {
      const button = event.target?.closest?.('#shareAppButton');
      if (!button) return;

      const shareUrl = `${window.location.origin}/app`;

      if (navigator.share) {
        try {
          await navigator.share({
            title: "Jyy'R Amprem",
            text: "Download Jyy'R Amprem di sini:",
            url: shareUrl
          });
        } catch (error) {
          if (error?.name !== 'AbortError') {
            console.error('[APP SHARE]', error);
          }
        }
        return;
      }

      try {
        await navigator.clipboard.writeText(shareUrl);
        alert('Link App berhasil disalin.');
      } catch (error) {
        console.error('[APP SHARE COPY]', error);
        window.prompt('Salin link App:', shareUrl);
      }
    });

    /* =========================================================
       LOAD RELEASE DATA
       ========================================================= */

    (async () => {
      try {
        const [
          latestRes,
          historyRes
        ] = await Promise.all([
          fetch(
            '/api/app/latest',
            {
              cache: 'no-store'
            }
          ),

          fetch(
            '/api/app/releases?limit=20',
            {
              cache: 'no-store'
            }
          )
        ]);


        const latest =
          await latestRes.json();

        const history =
          await historyRes.json();


        if (
          latest?.ok &&
          latest.release
        ) {
          renderLatest(
            latest.release
          );
        } else {
          $('#latest').outerHTML = `
            <div class="status">
              Belum ada release terbaru.
            </div>
          `;

          $('#info').innerHTML = `
            <div class="status">
              Informasi release belum tersedia.
            </div>
          `;
        }


        renderHistory(
          history?.ok
            ? history.releases
            : []
        );

      } catch (error) {
        console.error(
          '[APP DOWNLOAD PAGE]',
          error
        );


        $('#latest').outerHTML = `
          <div class="status">
            Gagal memuat release terbaru.
          </div>
        `;


        $('#info').innerHTML = `
          <div class="status">
            Gagal memuat informasi aplikasi.
          </div>
        `;


        $('#history').innerHTML = `
          <div class="status">
            Gagal memuat riwayat release.
          </div>
        `;
      }
    })();
