// Studio themes. A theme is a palette (a [data-theme] block in tokens.css) plus
// a style pack (a [data-style] block in styles.css). The palette changes
// colour; the pack changes material — outlines, shadows, corners, texture and
// how things move. Layout belongs to neither, so nothing here can break a screen.

const THEME_KEY = 'htfw:theme';
const STYLE_KEY = 'htfw:style';
const VERSION_KEY = 'htfw:themeVersion';

// Bump when the studio default changes. Anyone carrying a choice from before
// the bump is moved to the new default once — otherwise a saved theme pins
// them to the old look forever and a redesign appears to do nothing.
const THEME_VERSION = '3';

function migrate() {
  try {
    if (localStorage.getItem(VERSION_KEY) === THEME_VERSION) return;
    localStorage.removeItem(THEME_KEY);
    localStorage.removeItem(STYLE_KEY);
    localStorage.setItem(VERSION_KEY, THEME_VERSION);
  } catch {
    /* private mode - just use the default */
  }
}
migrate();

export const STYLE_PACKS = [
  { id: 'modern', name: 'Modern comic', blurb: 'Flat colour, drawn ink, solid shadows. No glow anywhere.' },
  { id: 'comic', name: 'Retro comic', blurb: 'Newsprint, halftone dots, heavy uppercase.' },
  { id: 'toon', name: 'Cartoon', blurb: 'Round, chunky and bouncy. Buttons you can press.' },
  { id: 'flat', name: 'Minimal', blurb: 'Clean and dark. Light on ink, heavy on contrast.' },
  { id: 'hyperreal', name: 'Hyperreal', blurb: 'Layered glass, real depth, light that moves.' },
];

export const SKINS = [
  // ---- modern comic (the studio default) --------------------------------
  { id: 'peach', name: 'Peach Panel', style: 'modern', base: '#ffeee2', surface: '#fffaf5', accent: '#f97a5a', text: '#2e2118', border: '#2e2118' },
  { id: 'ink-night', name: 'Night Panel', style: 'modern', base: '#1b1613', surface: '#261f1a', accent: '#ff9e6b', text: '#f6ece2', border: '#f2e4d6' },
  { id: 'sunburst', name: 'Sunburst', style: 'modern', base: '#fff7ec', surface: '#ffffff', accent: '#ff5a4d', text: '#1a1a1a', border: '#1a1a1a' },
  { id: 'skyline', name: 'Skyline', style: 'modern', base: '#eaf3ff', surface: '#ffffff', accent: '#2f6bff', text: '#10182b', border: '#10182b' },
  { id: 'sherbet', name: 'Sherbet', style: 'modern', base: '#fdf0f7', surface: '#ffffff', accent: '#a855f7', text: '#281626', border: '#281626' },
  { id: 'midnight-ink', name: 'Midnight Ink', style: 'modern', base: '#16161b', surface: '#202028', accent: '#ffc93c', text: '#f7f4ec', border: '#f7f4ec' },

  // ---- flat -------------------------------------------------------------
  { id: 'hypnic', name: 'Hypnic Signal', style: 'flat', base: '#07070a', surface: '#0e0e13', accent: '#2de2e6', text: '#f2f3f5', border: 'rgba(255,255,255,0.14)' },
  { id: 'rose', name: 'Rose Static', style: 'flat', base: '#08070a', surface: '#100e14', accent: '#ff3d6e', text: '#f4f2f5', border: 'rgba(255,255,255,0.14)' },
  { id: 'iris', name: 'Iris', style: 'flat', base: '#09090b', surface: '#111114', accent: '#7c6cf0', text: '#f4f4f5', border: 'rgba(255,255,255,0.14)' },
  { id: 'ember', name: 'Ember', style: 'flat', base: '#09090b', surface: '#111114', accent: '#f97316', text: '#f4f4f5', border: 'rgba(255,255,255,0.14)' },
  { id: 'acid', name: 'Acid', style: 'flat', base: '#0a0b08', surface: '#12140f', accent: '#c8ff3d', text: '#f2f5ec', border: 'rgba(255,255,255,0.14)' },
  { id: 'cyberpunk', name: 'Cyberpunk', style: 'flat', base: '#060310', surface: '#0d0a1e', accent: '#00ffff', text: '#e8f6ff', border: 'rgba(0,255,255,0.35)' },
  { id: 'noir', name: 'Noir', style: 'flat', base: '#0d0d0d', surface: '#161616', accent: '#d22b2b', text: '#ededed', border: 'rgba(237,237,237,0.2)' },
  { id: 'paper', name: 'Paper', style: 'flat', base: '#faf7f2', surface: '#ffffff', accent: '#0f766e', text: '#17171a', border: 'rgba(20,20,25,0.14)' },

  // ---- comic ------------------------------------------------------------
  { id: 'newsprint', name: 'Comic Panel', style: 'comic', base: '#f4ecd8', surface: '#fffdf6', accent: '#e4002b', text: '#141414', border: '#141414' },
  { id: 'inkwell', name: 'Ink & Gold', style: 'comic', base: '#17161c', surface: '#221f2b', accent: '#ffd23f', text: '#f7f3e8', border: '#f7f3e8' },
  { id: 'pixel', name: 'Pixel Arcade', style: 'comic', base: '#1a1b2e', surface: '#232544', accent: '#7cff6b', text: '#e8e9ff', border: '#e8e9ff' },

  // ---- cartoon ----------------------------------------------------------
  { id: 'bubblegum', name: 'Bubblegum', style: 'toon', base: '#fff0f6', surface: '#ffffff', accent: '#ff4fa3', text: '#2b2233', border: '#2b2233' },
  { id: 'slime', name: 'Slime Time', style: 'toon', base: '#eafff4', surface: '#ffffff', accent: '#00c07a', text: '#123026', border: '#123026' },
  { id: 'bit16', name: '16-Bit', style: 'toon', base: '#1b2a4a', surface: '#243560', accent: '#ffce3e', text: '#eaf0ff', border: '#eaf0ff' },

  // ---- hyperreal --------------------------------------------------------
  { id: 'obsidian', name: 'Obsidian', style: 'hyperreal', base: '#05060a', surface: '#0d1017', accent: '#4da3ff', text: '#eef2f8', border: 'rgba(255,255,255,0.16)' },
  { id: 'aurora', name: 'Aurora', style: 'hyperreal', base: '#04070c', surface: '#0a121c', accent: '#57e8c0', text: '#eaf5ff', border: 'rgba(255,255,255,0.16)' },
  { id: 'magma', name: 'Magma', style: 'hyperreal', base: '#08050a', surface: '#140d12', accent: '#ff6a3d', text: '#f7eef0', border: 'rgba(255,255,255,0.16)' },
  { id: 'velvet', name: 'Velvet Gold', style: 'hyperreal', base: '#1a0b14', surface: '#24101c', accent: '#e0b455', text: '#f4eadb', border: 'rgba(224,180,85,0.3)' },
  { id: 'molten', name: 'Molten', style: 'hyperreal', base: '#180a06', surface: '#221009', accent: '#ff4d00', text: '#f6efec', border: 'rgba(255,120,50,0.3)' },
];

const byId = (id) => SKINS.find((s) => s.id === id);

export const Theme = {
  get current() {
    return localStorage.getItem(THEME_KEY) || 'peach';
  },

  get currentStyle() {
    return localStorage.getItem(STYLE_KEY) || byId(this.current)?.style || 'flat';
  },

  apply(id) {
    const skin = byId(id) ?? SKINS[0];
    const root = document.documentElement;
    root.setAttribute('data-theme', skin.id);
    root.setAttribute('data-style', skin.style);
    localStorage.setItem(THEME_KEY, skin.id);
    localStorage.setItem(STYLE_KEY, skin.style);
    // Keep the Android status bar in step with the skin.
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', skin.base);
    return skin;
  },

  /** Fills the picker with live swatches, grouped by style pack. */
  mountPicker(grid, onPick) {
    const nodes = [];

    for (const pack of STYLE_PACKS) {
      const skins = SKINS.filter((s) => s.style === pack.id);
      if (!skins.length) continue;

      const head = document.createElement('div');
      head.className = 'theme-group';
      head.innerHTML = '<b></b><small></small>';
      head.querySelector('b').textContent = pack.name;
      head.querySelector('small').textContent = pack.blurb;
      nodes.push(head);

      for (const skin of skins) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-swatch' + (skin.id === Theme.current ? ' active' : '');
        btn.dataset.swStyle = skin.style;
        btn.style.setProperty('--sw-surface', skin.surface);
        btn.style.setProperty('--sw-text', skin.text);
        btn.style.setProperty('--sw-border', skin.border);
        btn.style.setProperty('--sw-accent', skin.accent);
        btn.innerHTML = `<span class="swatch-dots">
            <i style="background:${skin.base}"></i>
            <i style="background:${skin.accent}"></i>
            <i style="background:${skin.text}"></i>
          </span><span class="sw-name"></span>`;
        btn.querySelector('.sw-name').textContent = skin.name;
        btn.addEventListener('click', () => {
          Theme.apply(skin.id);
          for (const el of grid.querySelectorAll('.theme-swatch')) el.classList.remove('active');
          btn.classList.add('active');
          onPick?.(skin);
        });
        nodes.push(btn);
      }
    }

    grid.replaceChildren(...nodes);
  },
};
