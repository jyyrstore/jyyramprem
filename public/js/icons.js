/* JYY'R AMPREM — fallback UI icon registry.
 * Non-login pages replace window.icon with the asset-backed renderer.
 * Keep only icons referenced by the current application as fallback SVGs.
 */

window.JYYR_ICONS = {
  close: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18"/>
    <path d="M9 8l6 8"/>
    <path d="M15 8l-6 8"/>
  </svg>`,

  home: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M5 12l-2 0l9 -9l9 9l-2 0"/>
    <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7"/>
    <path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6"/>
  </svg>`,

  trash: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M4 7l16 0"/>
    <path d="M10 11l0 6"/>
    <path d="M14 11l0 6"/>
    <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"/>
    <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"/>
  </svg>`,

  lock: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6"/>
    <path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0"/>
    <path d="M8 11v-4a4 4 0 1 1 8 0v4"/>
  </svg>`,

  edit: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1"/>
    <path d="M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415"/>
    <path d="M16 5l3 3"/>
  </svg>`,

  check: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M9 12l2 2l4 -4"/>
    <path d="M12 3c7.2 0 9 1.8 9 9c0 7.2 -1.8 9 -9 9c-7.2 0 -9 -1.8 -9 -9c0 -7.2 1.8 -9 9 -9"/>
  </svg>`,

  settings: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37a1.724 1.724 0 0 0 2.572 -1.065"/>
    <path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/>
  </svg>`,

  user: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M12 13a3 3 0 1 0 0 -6a3 3 0 0 0 0 6"/>
    <path d="M12 3c7.2 0 9 1.8 9 9c0 7.2 -1.8 9 -9 9c-7.2 0 -9 -1.8 -9 -9c0 -7.2 1.8 -9 9 -9"/>
    <path d="M6 20.05v-.05a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v.05"/>
  </svg>`,

  bell: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6"/>
    <path d="M9 17v1a3 3 0 0 0 6 0v-1"/>
  </svg>`,

  dashboard: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M4 18v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2"/>
    <path d="M4 9h16"/>
    <path d="M10 14l2 2l2 -2"/>
  </svg>`,

  store: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M3 21l18 0"/>
    <path d="M3 7v1a3 3 0 0 0 6 0v-1m0 1a3 3 0 0 0 6 0v-1m0 1a3 3 0 0 0 6 0v-1h-18l2 -4h14l2 4"/>
    <path d="M5 21l0 -10.15"/>
    <path d="M19 21l0 -10.15"/>
    <path d="M9 21v-4a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v4"/>
  </svg>`,

  logout: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2"/>
    <path d="M9 12h12l-3 -3"/>
    <path d="M18 15l3 -3"/>
  </svg>`,

  category: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M4 4h6v6h-6l0 -6"/>
    <path d="M14 4h6v6h-6l0 -6"/>
    <path d="M4 14h6v6h-6l0 -6"/>
    <path d="M14 17a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/>
  </svg>`,

  package: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M12 3l8 4.5v9l-8 4.5l-8-4.5v-9z"/>
    <path d="M12 12l8-4.5"/>
    <path d="M12 12v9"/>
    <path d="M4 7.5l8 4.5"/>
  </svg>`,

  receipt: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16l-3 -2l-3 2l-3 -2z"/>
    <path d="M9 9h6"/>
    <path d="M9 13h6"/>
  </svg>`,

  broadcast: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M15 8a5 5 0 0 1 0 8"/>
    <path d="M17.7 5.3a9 9 0 0 1 0 13.4"/>
    <path d="M9 12h-1a2 2 0 0 0 -2 2v1a2 2 0 0 0 2 2h1l4 3v-14z"/>
  </svg>`,

  chart: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M4 19v-8"/>
    <path d="M10 19v-14"/>
    <path d="M16 19v-5"/>
    <path d="M22 19v-9"/>
  </svg>`,

  plus: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M12 5v14"/>
    <path d="M5 12h14"/>
  </svg>`,

  refresh: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/>
    <path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>
  </svg>`,

  arrowRight: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M5 12h14"/>
    <path d="M13 18l6 -6l-6 -6"/>
  </svg>`,

  file: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M14 3v4a1 1 0 0 0 1 1h4"/>
    <path d="M5 3h9l5 5v13h-14z"/>
    <path d="M9 13h6"/>
    <path d="M9 17h6"/>
  </svg>`,

  shield: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M12 3l7 4v5c0 5 -3.5 8 -7 9c-3.5 -1 -7 -4 -7 -9v-5z"/>
    <path d="M9 12l2 2l4 -4"/>
  </svg>`,

  help: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 17v.01"/>
    <path d="M12 13a2 2 0 1 0 -2 -2"/>
    <path d="M10 9a2 2 0 1 1 2 2"/>
  </svg>`,

  message: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M4 20l3.5 -3h8.5a4 4 0 0 0 4 -4v-5a4 4 0 0 0 -4 -4h-8a4 4 0 0 0 -4 4z"/>
    <path d="M8 10h.01"/>
    <path d="M12 10h.01"/>
    <path d="M16 10h.01"/>
  </svg>`,

  crown: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M3 8l4 3l5 -6l5 6l4 -3l-2 10h-14z"/>
    <path d="M5 21h14"/>
  </svg>`,

  star: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M12 3l2.7 5.5l6.3.9l-4.5 4.4l1.1 6.2l-5.6 -3l-5.6 3l1.1 -6.2l-4.5 -4.4l6.3 -.9z"/>
  </svg>`,

  gift: `<svg class="ui-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round">
    <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
    <path d="M20 12v8a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1v-8"/>
    <path d="M2 7h20v5h-20z"/>
    <path d="M12 7v14"/>
    <path d="M12 7H8.5a2.5 2.5 0 1 1 0 -5c3.5 0 3.5 5 3.5 5"/>
    <path d="M12 7h3.5a2.5 2.5 0 1 0 0 -5c-3.5 0 -3.5 5 -3.5 5"/>
  </svg>`
};

window.icon = function icon(name, className = "ui-icon") {
  const raw = window.JYYR_ICONS[name];

  if (!raw) {
    return "";
  }

  return raw.replace(/class="ui-icon"/, `class="${className}"`);
};