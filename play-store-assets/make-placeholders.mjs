import sharp from 'sharp';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PLACEHOLDERS = [
  { n: 1, label: '1 — Server view',         color: '#1E1F22' },
  { n: 2, label: '2 — Voice channel',       color: '#2A1F35' },
  { n: 3, label: '3 — Encrypted DM',        color: '#1A2F2A' },
  { n: 4, label: '4 — Rich messaging',      color: '#2F2A1A' },
  { n: 5, label: '5 — Roles &amp; permissions', color: '#2A1A1F' },
  { n: 6, label: '6 — Mobile single-pane',  color: '#1F1A2A' }
];

const W = 1080, H = 2400;

for (const p of PLACEHOLDERS) {
  const svg = `
    <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${p.color}"/>
          <stop offset="100%" stop-color="#0D1117"/>
        </linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#g)"/>
      <text x="50%" y="50%" font-family="Inter, sans-serif" font-size="72"
            font-weight="700" fill="#F0F6FC" text-anchor="middle"
            dominant-baseline="middle">PLACEHOLDER</text>
      <text x="50%" y="56%" font-family="Inter, sans-serif" font-size="42"
            font-weight="500" fill="#8B949E" text-anchor="middle"
            dominant-baseline="middle">${p.label}</text>
    </svg>
  `;
  const out = resolve(__dirname, 'raw', `raw-${p.n}.png`);
  await sharp(Buffer.from(svg)).png().toFile(out);
  console.log(`Made ${out}`);
}
