import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, statSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const width = 1080;
const height = 2400;
const outDir = resolve("assets/wallpapers");
const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
mkdirSync(outDir, { recursive: true });

function mulberry32(seed) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function polar(cx, cy, radius, angle) {
  return [
    cx + Math.cos(angle - Math.PI / 2) * radius,
    cy + Math.sin(angle - Math.PI / 2) * radius,
  ];
}

function petalPath(cx, cy, inner, outer, a0, a1) {
  const am = (a0 + a1) / 2;
  const p0 = polar(cx, cy, inner, a0);
  const p1 = polar(cx, cy, outer, am);
  const p2 = polar(cx, cy, inner, a1);
  return `M ${p0[0].toFixed(2)} ${p0[1].toFixed(2)} Q ${p1[0].toFixed(2)} ${p1[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
}

function ringPattern(cx, cy, r, sides, rotate = 0) {
  const points = [];
  for (let i = 0; i < sides; i++) {
    const [x, y] = polar(cx, cy, r, rotate + (Math.PI * 2 * i) / sides);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(" ");
}

function buildMandala(variant) {
  const cx = width / 2;
  const cy = 790 + variant.cyShift;
  const teal = variant.teal;
  const pale = variant.pale;
  const lines = [];

  lines.push(`<g opacity="${variant.opacity}" filter="url(#embossTeal)">`);
  lines.push(`<circle cx="${cx}" cy="${cy}" r="382" fill="none" stroke="${pale}" stroke-width="1.15" opacity=".46"/>`);
  lines.push(`<circle cx="${cx}" cy="${cy}" r="314" fill="none" stroke="${teal}" stroke-width="1" opacity=".6" stroke-dasharray="2 12"/>`);
  lines.push(`<circle cx="${cx}" cy="${cy}" r="246" fill="none" stroke="${pale}" stroke-width="1.25" opacity=".64"/>`);
  lines.push(`<circle cx="${cx}" cy="${cy}" r="182" fill="none" stroke="${teal}" stroke-width=".95" opacity=".68" stroke-dasharray="8 9"/>`);

  const layers = [
    { count: 8, inner: 92, outer: 378, width: 1.25, color: pale, spread: 0.21, opacity: 0.8 },
    { count: 16, inner: 118, outer: 338, width: 0.82, color: teal, spread: 0.13, opacity: 0.64 },
    { count: 24, inner: 166, outer: 392, width: 0.62, color: pale, spread: 0.08, opacity: 0.5 },
    { count: 32, inner: 230, outer: 422, width: 0.48, color: teal, spread: 0.055, opacity: 0.42 },
  ];

  for (const layer of layers) {
    for (let i = 0; i < layer.count; i++) {
      const a = (Math.PI * 2 * i) / layer.count + variant.rotation;
      lines.push(
        `<path d="${petalPath(cx, cy, layer.inner, layer.outer, a - layer.spread, a + layer.spread)}" fill="none" stroke="${layer.color}" stroke-width="${layer.width}" opacity="${layer.opacity}" stroke-linecap="round"/>`,
      );
    }
  }

  for (let i = 0; i < 64; i++) {
    const a = (Math.PI * 2 * i) / 64 + variant.rotation / 2;
    const [x1, y1] = polar(cx, cy, 286, a);
    const [x2, y2] = polar(cx, cy, 430 + (i % 2) * 18, a);
    lines.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${i % 2 ? teal : pale}" stroke-width=".45" opacity=".34"/>`);
  }

  for (const r of [278, 330, 386, 438]) {
    const sides = r === 438 ? 32 : 16;
    lines.push(`<polygon points="${ringPattern(cx, cy, r, sides, variant.rotation)}" fill="none" stroke="${r % 2 ? pale : teal}" stroke-width=".65" opacity=".38"/>`);
    lines.push(`<polygon points="${ringPattern(cx, cy, r - 22, sides, variant.rotation + Math.PI / sides)}" fill="none" stroke="${teal}" stroke-width=".45" opacity=".32"/>`);
  }

  lines.push(`</g>`);

  lines.push(`<g filter="url(#goldPress)">`);
  lines.push(`<circle cx="${cx}" cy="${cy}" r="124" fill="url(#centerVoid)" stroke="url(#goldStroke)" stroke-width="9"/>`);
  lines.push(`<circle cx="${cx}" cy="${cy}" r="104" fill="none" stroke="#f3d48a" stroke-width="1.4" opacity=".72"/>`);
  lines.push(`<circle cx="${cx}" cy="${cy}" r="139" fill="none" stroke="#9a7331" stroke-width="1" opacity=".62"/>`);
  for (let i = 0; i < 12; i++) {
    const a0 = (Math.PI * 2 * i) / 12 + variant.rotation;
    const p1 = polar(cx, cy, 28, a0);
    const p2 = polar(cx, cy, 88, a0 + Math.PI / 12);
    const p3 = polar(cx, cy, 88, a0 - Math.PI / 12);
    lines.push(`<path d="M ${p1[0].toFixed(2)} ${p1[1].toFixed(2)} L ${p2[0].toFixed(2)} ${p2[1].toFixed(2)} L ${p3[0].toFixed(2)} ${p3[1].toFixed(2)} Z" fill="url(#triGold)" opacity="${0.38 + (i % 3) * 0.07}" stroke="#d9b25b" stroke-width=".7"/>`);
  }
  lines.push(`<circle cx="${cx}" cy="${cy}" r="36" fill="#173d35" opacity=".72"/>`);
  lines.push(`<circle cx="${cx}" cy="${cy}" r="31" fill="none" stroke="#edcc80" stroke-width="1" opacity=".52"/>`);
  lines.push(`</g>`);

  return lines.join("\n");
}

function stars(seed, amount, stronger = false) {
  const rand = mulberry32(seed);
  const dots = [];
  for (let i = 0; i < amount; i++) {
    const edgeBias = rand();
    let x = rand() * width;
    let y = rand() * height;
    if (edgeBias < 0.62) {
      const side = Math.floor(rand() * 4);
      if (side === 0) x = rand() * 120;
      if (side === 1) x = width - rand() * 120;
      if (side === 2) y = rand() * 220;
      if (side === 3) y = height - rand() * 280;
    }
    if (y > 1160 && rand() < 0.55) continue;
    const r = rand() < 0.88 ? 0.75 + rand() * 1.2 : 1.8 + rand() * 1.6;
    const opacity = stronger ? 0.22 + rand() * 0.52 : 0.16 + rand() * 0.4;
    dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#f6fbff" opacity="${opacity.toFixed(2)}"/>`);
  }
  return `<g filter="url(#starGlow)">${dots.join("\n")}</g>`;
}

function svg(variant, index) {
  const cx = width / 2;
  const cy = 790 + variant.cyShift;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${variant.bgTop}"/>
      <stop offset=".46" stop-color="${variant.bgMid}"/>
      <stop offset="1" stop-color="${variant.bgBottom}"/>
    </linearGradient>
    <radialGradient id="halo" cx="50%" cy="30%" r="58%">
      <stop offset="0" stop-color="#2f6d5a" stop-opacity=".48"/>
      <stop offset=".42" stop-color="#173d35" stop-opacity=".16"/>
      <stop offset="1" stop-color="#071f1d" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="goldStroke" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8e672c"/>
      <stop offset=".18" stop-color="#f0d087"/>
      <stop offset=".45" stop-color="#b68b43"/>
      <stop offset=".68" stop-color="#fff0b6"/>
      <stop offset="1" stop-color="#8a6229"/>
    </linearGradient>
    <linearGradient id="triGold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7a5729"/>
      <stop offset=".44" stop-color="#e7c06d"/>
      <stop offset="1" stop-color="#fff0b5"/>
    </linearGradient>
    <radialGradient id="centerVoid" cx="52%" cy="42%" r="62%">
      <stop offset="0" stop-color="#214d42"/>
      <stop offset=".52" stop-color="#143932"/>
      <stop offset="1" stop-color="#092421"/>
    </radialGradient>
    <filter id="leather">
      <feTurbulence type="fractalNoise" baseFrequency="${variant.noise}" numOctaves="5" seed="${variant.seed}" result="noise"/>
      <feColorMatrix type="matrix" values="0.20 0 0 0 0  0 0.28 0 0 0  0 0 0.23 0 0  0 0 0 .18 0" result="grain"/>
      <feBlend in="SourceGraphic" in2="grain" mode="soft-light"/>
    </filter>
    <filter id="embossTeal" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1.4" stdDeviation=".8" flood-color="#031312" flood-opacity=".42"/>
      <feDropShadow dx="0" dy="-0.7" stdDeviation=".45" flood-color="#d5ffff" flood-opacity=".11"/>
    </filter>
    <filter id="goldPress" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#02110f" flood-opacity=".38"/>
      <feDropShadow dx="0" dy="-2" stdDeviation="1.2" flood-color="#fff1bc" flood-opacity=".28"/>
    </filter>
    <filter id="starGlow">
      <feGaussianBlur stdDeviation=".35" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <pattern id="brushed" width="13" height="13" patternUnits="userSpaceOnUse" patternTransform="rotate(32)">
      <rect width="13" height="13" fill="transparent"/>
      <path d="M0 2 H13 M0 7 H13 M0 11 H13" stroke="#fff2b8" stroke-opacity=".08" stroke-width=".9"/>
    </pattern>
  </defs>
  <rect width="1080" height="2400" fill="url(#bg)" filter="url(#leather)"/>
  <rect width="1080" height="2400" fill="url(#halo)"/>
  <rect width="1080" height="2400" fill="url(#brushed)" opacity=".18"/>
  ${stars(variant.seed * 17 + 9, variant.starCount, variant.starStrong)}
  <g transform="translate(0 ${variant.floatOffset})">
    <ellipse cx="${cx}" cy="${cy + 22}" rx="318" ry="318" fill="#051b19" opacity=".22" filter="url(#starGlow)"/>
    ${buildMandala(variant)}
  </g>
  <path d="M0 1350 C260 1430 834 1374 1080 1460 L1080 2400 L0 2400 Z" fill="#061f1d" opacity="${variant.lowerFade}"/>
  <rect x="64" y="1760" width="952" height="1" fill="#acdcd8" opacity=".045"/>
  <circle cx="${cx}" cy="${cy + variant.floatOffset}" r="476" fill="none" stroke="#b5fffa" stroke-opacity=".035" stroke-width="1"/>
</svg>`;
}

const variants = [
  {
    seed: 1807,
    bgTop: "#092621",
    bgMid: "#123d34",
    bgBottom: "#051b19",
    teal: "#73d6d2",
    pale: "#b8f0eb",
    opacity: 0.82,
    rotation: 0,
    cyShift: -18,
    floatOffset: 0,
    noise: "0.93",
    starCount: 175,
    starStrong: false,
    lowerFade: 0.48,
  },
  {
    seed: 2419,
    bgTop: "#0b2d27",
    bgMid: "#174b3e",
    bgBottom: "#061d1d",
    teal: "#68cfd8",
    pale: "#c2f4ea",
    opacity: 0.76,
    rotation: Math.PI / 16,
    cyShift: -44,
    floatOffset: -10,
    noise: "0.78",
    starCount: 220,
    starStrong: true,
    lowerFade: 0.54,
  },
  {
    seed: 3221,
    bgTop: "#071f1e",
    bgMid: "#103f36",
    bgBottom: "#082321",
    teal: "#85d7ce",
    pale: "#a7ecea",
    opacity: 0.88,
    rotation: Math.PI / 32,
    cyShift: 8,
    floatOffset: 18,
    noise: "1.06",
    starCount: 155,
    starStrong: false,
    lowerFade: 0.42,
  },
  {
    seed: 4127,
    bgTop: "#0e3129",
    bgMid: "#1a5342",
    bgBottom: "#061c1a",
    teal: "#61c8c8",
    pale: "#c5f6f1",
    opacity: 0.78,
    rotation: Math.PI / 8,
    cyShift: -10,
    floatOffset: 8,
    noise: "0.86",
    starCount: 245,
    starStrong: true,
    lowerFade: 0.58,
  },
];

for (let i = 0; i < variants.length; i++) {
  const name = `galaxy-mandala-no-text-${String(i + 1).padStart(2, "0")}`;
  const svgPath = join(outDir, `${name}.svg`);
  const pngPath = join(outDir, `${name}.png`);
  writeFileSync(svgPath, svg(variants[i], i + 1), "utf8");
  rmSync(pngPath, { force: true });
  execFileSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--window-size=${width},${height}`,
      `--screenshot=${pngPath}`,
      pathToFileURL(svgPath).href,
    ],
    { stdio: "inherit" },
  );
  const size = statSync(pngPath).size;
  console.log(`${pngPath} ${size} bytes`);
}
