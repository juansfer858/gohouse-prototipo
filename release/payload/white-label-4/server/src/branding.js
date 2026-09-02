import { getRoot } from './store.js';

export const brandingDefaults = Object.freeze({
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
  bankAccount: '',
  porcentajeCasa: 17.14,
  valorSugerido: 3500
});

const publicKeys = Object.keys(brandingDefaults);

export function normalizeBranding(raw = {}) {
  const out = { ...brandingDefaults };
  for (const key of publicKeys) if (raw[key] !== undefined) out[key] = raw[key];
  for (const key of ['brandName','shortName','legalName','nit','phone','whatsapp','email','address','city','hours','supportText','logoUrl','appIconUrl','paymentQrUrl','nequiNumber','daviplataNumber','bankName','bankAccount']) {
    out[key] = String(out[key] ?? '').trim();
  }
  if (!out.brandName) out.brandName = brandingDefaults.brandName;
  if (!out.shortName) out.shortName = out.brandName.slice(0, 12);
  for (const key of ['primaryColor','accentColor','successColor']) {
    if (!/^#[0-9a-f]{6}$/i.test(String(out[key] || ''))) out[key] = brandingDefaults[key];
  }
  const percentage = Number(out.porcentajeCasa);
  out.porcentajeCasa = Number.isFinite(percentage) && percentage > 0 && percentage < 100 ? percentage : brandingDefaults.porcentajeCasa;
  const suggested = Number(out.valorSugerido);
  out.valorSugerido = Number.isFinite(suggested) && suggested > 0 ? Math.round(suggested) : brandingDefaults.valorSugerido;
  return out;
}

export async function getPublicBranding() {
  const { data } = await getRoot();
  return normalizeBranding(data?.['gohouse-data']?.config || {});
}

export function manifestFor(appKind, cfg) {
  const kind = ['client','panel','driver'].includes(appKind) ? appKind : 'client';
  const label = kind === 'panel' ? 'Panel' : kind === 'driver' ? 'Domiciliarios' : '';
  const icon = cfg.appIconUrl || cfg.logoUrl || '';
  const startUrl = kind === 'panel' ? '/panel/' : kind === 'driver' ? '/domiciliario/' : '/';
  const short = kind === 'client' ? cfg.shortName : `${cfg.shortName} ${kind === 'panel' ? 'Panel' : 'Domi'}`.slice(0, 24);
  return {
    name: label ? `${cfg.brandName} — ${label}` : cfg.brandName,
    short_name: short,
    start_url: startUrl,
    scope: kind === 'panel' ? '/panel/' : kind === 'driver' ? '/domiciliario/' : '/',
    display: 'standalone',
    background_color: '#0F1B2B',
    theme_color: cfg.primaryColor,
    description: cfg.supportText || `${cfg.brandName} · Servicio de domicilios`,
    icons: icon ? [{ src: icon, sizes: '512x512', type: icon.toLowerCase().endsWith('.svg') ? 'image/svg+xml' : 'image/png', purpose: 'any maskable' }] : []
  };
}
