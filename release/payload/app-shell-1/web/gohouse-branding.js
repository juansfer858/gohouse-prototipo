/* GoHouse white-label runtime.
   Carga la identidad comercial desde el VPS y la aplica a Cliente, Panel y Domiciliario. */
(() => {
  'use strict';

  const DEFAULTS = Object.freeze({
    brandName: 'Domicilios',
    shortName: 'Domicilios',
    legalName: '',
    nit: '',
    phone: '',
    whatsapp: '',
    email: '',
    address: '',
    city: 'Yarumal',
    hours: '',
    supportText: '',
    primaryColor: '#E8863A',
    accentColor: '#34C6C0',
    successColor: '#5FBF8B',
    logoUrl: '',
    appIconUrl: '',
    paymentQrUrl: '',
    nequiNumber: '',
    daviplataNumber: '',
    bankName: '',
    bankAccount: ''
  });

  let config = { ...DEFAULTS };
  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  let observer = null;

  function ensureNoBrandFlash() {
    if (document.getElementById('white-label-boot-style')) return;
    const st = document.createElement('style');
    st.id = 'white-label-boot-style';
    st.textContent = 'html:not([data-brand-ready]) body{visibility:hidden}';
    document.head.appendChild(st);
  }

  function cleanVisibleRoute() {
    const p = location.pathname.toLowerCase();
    let target = '';
    if (p.endsWith('/gohouse-cliente.html')) target = '/';
    else if (p.endsWith('/gohouse-panel.html')) target = '/panel';
    else if (p.endsWith('/gohouse-domiciliarios.html')) target = '/domiciliario';
    if (target && location.pathname !== target) {
      try { history.replaceState(history.state, '', target + location.search + location.hash); } catch {}
    }
  }

  function pageKind() {
    const p = location.pathname.toLowerCase();
    if (p.includes('panel')) return 'panel';
    if (p.includes('domiciliario')) return 'driver';
    return 'client';
  }

  function normalize(raw) {
    const out = { ...DEFAULTS, ...(raw || {}) };
    for (const k of ['brandName','shortName','legalName','nit','phone','whatsapp','email','address','city','hours','supportText','logoUrl','appIconUrl','paymentQrUrl','nequiNumber','daviplataNumber','bankName','bankAccount']) {
      out[k] = String(out[k] ?? '').trim();
    }
    if (!out.brandName) out.brandName = DEFAULTS.brandName;
    if (!out.shortName) out.shortName = out.brandName.slice(0, 12);
    for (const k of ['primaryColor','accentColor','successColor']) {
      if (!/^#[0-9a-f]{6}$/i.test(String(out[k] || ''))) out[k] = DEFAULTS[k];
    }
    return out;
  }

  function textReplace(value) {
    if (!value) return value;
    const brand = config.brandName;
    return String(value)
      .replace(/¡GO!\s*HOUSE/gi, brand)
      .replace(/GO!\s*HOUSE/gi, brand)
      .replace(/GOHOUSE/gi, brand)
      .replace(/GO\s+HOUSE/gi, brand);
  }

  function shouldSkip(el) {
    return !el || ['SCRIPT','STYLE','TEXTAREA','OPTION','CODE','PRE'].includes(el.tagName);
  }

  function brandNode(root) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      const parent = root.parentElement;
      if (!shouldSkip(parent)) {
        const next = textReplace(root.nodeValue);
        if (next !== root.nodeValue) root.nodeValue = next;
      }
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (root.nodeType === Node.ELEMENT_NODE && shouldSkip(root)) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) brandNode(node);

    const scope = root.querySelectorAll ? root.querySelectorAll('[title],[aria-label],[placeholder]') : [];
    for (const el of scope) {
      for (const attr of ['title','aria-label','placeholder']) {
        if (el.hasAttribute(attr)) {
          const before = el.getAttribute(attr);
          const after = textReplace(before);
          if (after !== before) el.setAttribute(attr, after);
        }
      }
    }
  }

  function applyLogo() {
    if (!config.logoUrl) return;
    const selectors = [
      '.logo-mark img',
      'img[alt*="GO! House" i]',
      'img[alt*="GoHouse" i]',
      'img[alt*="Go House" i]'
    ];
    document.querySelectorAll(selectors.join(',')).forEach(img => {
      if (img.dataset.whiteLabelLogo === config.logoUrl) return;
      img.src = config.logoUrl;
      img.alt = `Logo ${config.brandName}`;
      img.dataset.whiteLabelLogo = config.logoUrl;
    });
  }

  function ensureIconLink(rel, href) {
    if (!href) return;
    let link = document.head.querySelector(`link[rel="${rel}"]`);
    if (!link) {
      link = document.createElement('link');
      link.rel = rel;
      document.head.appendChild(link);
    }
    link.href = href;
  }

  function applyMeta() {
    const kind = pageKind();
    const suffix = kind === 'panel' ? 'Panel' : kind === 'driver' ? 'Domiciliarios' : 'Pedir un domicilio';
    document.title = `${config.brandName} — ${suffix}`;
    const theme = document.querySelector('meta[name="theme-color"]');
    if (theme) theme.content = config.primaryColor;
    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appleTitle) appleTitle.content = kind === 'client' ? config.shortName : `${config.shortName} ${kind === 'panel' ? 'Panel' : 'Domi'}`.slice(0, 24);
    if (config.appIconUrl) {
      ensureIconLink('icon', config.appIconUrl);
      ensureIconLink('apple-touch-icon', config.appIconUrl);
    }
  }

  function applyColors() {
    const root = document.documentElement.style;
    root.setProperty('--mango', config.primaryColor);
    root.setProperty('--teal', config.primaryColor);
    root.setProperty('--orange', config.accentColor);
    root.setProperty('--green', config.successColor);
  }

  function applyCommercialData() {
    const qrBox = document.getElementById('qr-box-entrega');
    if (qrBox) {
      const accounts = [];
      if (config.nequiNumber) accounts.push(`Nequi: ${config.nequiNumber}`);
      if (config.daviplataNumber) accounts.push(`Daviplata: ${config.daviplataNumber}`);
      if (config.bankName || config.bankAccount) accounts.push([config.bankName,config.bankAccount].filter(Boolean).join(' · '));
      qrBox.innerHTML = `${config.paymentQrUrl ? `<img src="${escapeAttr(config.paymentQrUrl)}" alt="QR de pago" style="width:170px;max-width:100%;height:auto;border-radius:12px;background:#fff;padding:6px;">` : '<div class="qr-placeholder">Pago electrónico</div>'}<div class="qr-account">${escapeHtml(accounts.join(' · ') || 'Datos de pago disponibles con el operador')}</div>`;
    }
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function escapeAttr(value) { return escapeHtml(value); }

  function loadExtension(id, src) {
    if (document.getElementById(id)) return;
    const s = document.createElement('script');
    s.id = id;
    s.src = src;
    s.defer = true;
    document.head.appendChild(s);
  }

  function loadExtensions() {
    const kind = pageKind();
    loadExtension('white-label-app-shell-script', '/gohouse-app-shell.js');
    if (kind === 'panel') loadExtension('white-label-qr-script', '/gohouse-qr.js');
    if (kind === 'panel' || kind === 'client') loadExtension('white-label-publicidad-script', '/gohouse-publicidad.js');
  }

  function apply() {
    cleanVisibleRoute();
    applyColors();
    applyMeta();
    brandNode(document.body || document.documentElement);
    applyLogo();
    applyCommercialData();
    document.documentElement.dataset.brandName = config.brandName;
    document.documentElement.dataset.brandReady = '1';
    window.dispatchEvent(new CustomEvent('gohouse:brand-applied', { detail: { ...config } }));
  }

  async function load() {
    try {
      const res = await fetch('/api/public/config', { cache: 'no-store' });
      if (res.ok) config = normalize(await res.json());
      else config = normalize(config);
    } catch {
      config = normalize(config);
    }
    apply();
    loadExtensions();
    if (!observer && document.body) {
      observer = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            brandNode(node);
            if (node.nodeType === Node.ELEMENT_NODE) applyLogo();
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    readyResolve?.(config);
    readyResolve = null;
    return config;
  }

  async function reload() {
    const res = await fetch(`/api/public/config?_=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('No se pudo recargar la identidad');
    config = normalize(await res.json());
    apply();
    return config;
  }

  window.GoHouseBrand = {
    defaults: DEFAULTS,
    get config(){ return { ...config }; },
    ready,
    reload,
    apply
  };

  ensureNoBrandFlash();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load, { once:true });
  else load();
})();
