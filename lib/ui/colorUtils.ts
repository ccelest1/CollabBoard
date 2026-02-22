export type RgbColor = { r: number; g: number; b: number };
export type HslColor = { h: number; s: number; l: number };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function expandShortHex(hex: string) {
  if (hex.length !== 3) return hex;
  return hex
    .split("")
    .map((char) => `${char}${char}`)
    .join("");
}

function normalizeHexInput(hex: string) {
  const raw = hex.trim().replace(/^#/, "").toUpperCase();
  if (!/^[0-9A-F]{3}$|^[0-9A-F]{6}$/.test(raw)) return null;
  const normalized = expandShortHex(raw);
  return `#${normalized}`;
}

export function hexToRgb(hex: string): RgbColor {
  const normalized = normalizeHexInput(hex);
  if (!normalized) return { r: 255, g: 255, b: 255 };
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (value: number) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function rgbToHsl(r: number, g: number, b: number): HslColor {
  const rn = clamp(r, 0, 255) / 255;
  const gn = clamp(g, 0, 255) / 255;
  const bn = clamp(b, 0, 255) / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) * 60;
    else if (max === gn) h = ((bn - rn) / delta + 2) * 60;
    else h = ((rn - gn) / delta + 4) * 60;
  }

  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function hslToRgb(h: number, s: number, l: number): RgbColor {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;

  if (sat === 0) {
    const gray = Math.round(light * 255);
    return { r: gray, g: gray, b: gray };
  }

  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const hh = hue / 60;
  const x = chroma * (1 - Math.abs((hh % 2) - 1));
  let rp = 0;
  let gp = 0;
  let bp = 0;

  if (hh >= 0 && hh < 1) {
    rp = chroma;
    gp = x;
  } else if (hh >= 1 && hh < 2) {
    rp = x;
    gp = chroma;
  } else if (hh >= 2 && hh < 3) {
    gp = chroma;
    bp = x;
  } else if (hh >= 3 && hh < 4) {
    gp = x;
    bp = chroma;
  } else if (hh >= 4 && hh < 5) {
    rp = x;
    bp = chroma;
  } else {
    rp = chroma;
    bp = x;
  }

  const m = light - chroma / 2;
  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

export function normalizeHex(hex: string) {
  return normalizeHexInput(hex);
}
