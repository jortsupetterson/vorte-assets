// pwa.js — Generoi PWA-assetit kaikille (1,2,3) ja printtaa täyden <head> vain Assistant 3:lle.
// VAATIMUKSET: Node 18+, package.json: { "type": "module" }
// Asennus: npm i sharp svgo png-to-ico

import fs from "fs/promises";
import path from "node:path";
import sharp from "sharp";
import { optimize } from "svgo";
import pngToIco from "png-to-ico";

// ===== KONFFI =====
const INPUT_SVG = "./src/images/favicons/vorte.svg"; // Lähde: valkoinen logo, läpinäkyvä tausta
const OUT_BASE = "./src/images/favicons"; // Kohdejuuri

const ASSISTANTS = [
  { id: 1, color: "#000000", name: "Vortius" },
  { id: 2, color: "#D58A8B", name: "Vortina" },
  { id: 3, color: "#199473", name: "Vor" },
];

// iOS splash -koot (portrait)
const SPLASH_DEVICES = [
  { cssW: 393, cssH: 852, dpr: 3, pxW: 1179, pxH: 2556 }, // iPhone 15 Pro
  { cssW: 430, cssH: 932, dpr: 3, pxW: 1290, pxH: 2796 }, // 15 Pro Max
  { cssW: 428, cssH: 926, dpr: 3, pxW: 1284, pxH: 2778 }, // 12/13/14 Pro Max
  { cssW: 390, cssH: 844, dpr: 3, pxW: 1170, pxH: 2532 }, // 12/13/14/15
  { cssW: 1024, cssH: 1366, dpr: 2, pxW: 2048, pxH: 2732 }, // iPad Pro 12.9
];

// Kaikki rasterit PEITTÄVINÄ (ei läpinäkyviä)
const RASTERS = [
  { name: "favicon-16x16.png", size: 16 },
  { name: "favicon-32x32.png", size: 32 },
  { name: "favicon-192x192.png", size: 192 },
  { name: "favicon-512x512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
];

// ===== APURIT =====
async function writeFileSafe(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data);
}

function ensureSvgNamespaceAndViewBox(svg) {
  let out = svg;
  if (!out.includes('xmlns="http://www.w3.org/2000/svg"')) {
    out = out.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  const hasViewBox = /viewBox\s*=/.test(out);
  const wMatch = out.match(/\bwidth="([\d.]+)"/);
  const hMatch = out.match(/\bheight="([\d.]+)"/);
  if (!hasViewBox && wMatch && hMatch) {
    out = out.replace(
      /^<svg([^>]*)>/,
      (_m, a) =>
        `<svg${a} viewBox="0 0 ${Number(wMatch[1])} ${Number(hMatch[1])}">`
    );
  }
  return out;
}

// Muunna lähde-SVG:ksi, jossa PEITTÄVÄ tausta + valkoinen logo (ei media-prefersiä)
function makeSolidSvg(svg, bgHex, fgHex = "#fff") {
  const safe = ensureSvgNamespaceAndViewBox(svg).replace(/\sfill="[^"]*"/g, "");
  return safe.replace(
    /^<svg([^>]*)>([\s\S]*?)<\/svg>\s*$/i,
    (_m, attrs, inner) =>
      `<svg${attrs}>` +
      `<rect width="100%" height="100%" fill="${bgHex}"/>` +
      `<g fill="${fgHex}">${inner}</g>` +
      `</svg>`
  );
}

// Renderöi neliö-rasterin: PEITTÄVÄ tausta + valkoinen logo
async function rasterFromSvgSolid(svgString, outSize, bgHex) {
  const base = sharp({
    create: { width: outSize, height: outSize, channels: 4, background: bgHex },
  });

  const iconBuf = await sharp(Buffer.from(svgString), {
    density: Math.max(384, outSize * 3),
    limitInputPixels: false,
  })
    .resize(outSize, outSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: "lanczos3",
      withoutEnlargement: false,
    })
    .png({ compressionLevel: 9, effort: 9 })
    .toBuffer();

  return await base
    .composite([{ input: iconBuf, left: 0, top: 0 }])
    .png({ compressionLevel: 9, effort: 9 })
    .toBuffer();
}

// iOS splash: PEITTÄVÄ tausta + keskitetty valkoinen logo
async function renderSplashSolid(svgString, outW, outH, bgHex, scale = 0.42) {
  const iconSize = Math.floor(Math.min(outW, outH) * scale);

  const iconBuf = await sharp(Buffer.from(svgString), {
    density: Math.max(384, iconSize * 3),
    limitInputPixels: false,
  })
    .resize(iconSize, iconSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9, effort: 9 })
    .toBuffer();

  const canvas = sharp({
    create: { width: outW, height: outH, channels: 4, background: bgHex },
  });

  return await canvas
    .composite([
      {
        input: iconBuf,
        left: Math.floor((outW - iconSize) / 2),
        top: Math.floor((outH - iconSize) / 2),
      },
    ])
    .png({ compressionLevel: 9, effort: 9 })
    .toBuffer();
}

// Tulostettava HEAD Assistant 3:lle (täydellinen, mitään poistamatta)
function headHtmlForAssistant3() {
  const baseUrl = `/images/favicons/3`;
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="robots" content="noindex, nofollow" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Layout Development Area</title>

    <meta name="application-name" content="Vorte" />
    <meta name="mobile-web-app-cabable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Vorte" />

    <link rel="stylesheet" href="/styles/base/min.css" />
    <link rel="stylesheet" href="/styles/layout/min.css" />

    <link rel="icon" href="${baseUrl}/favicon.ico" sizes="any" />
    <link rel="icon" type="image/svg+xml" href="${baseUrl}/icon.svg" />
    <link
      rel="apple-touch-icon"
      sizes="180x180"
      href="${baseUrl}/apple-touch-icon.png"
    />
    <link
      rel="mask-icon"
      href="${baseUrl}/safari-pinned-tab.svg"
      color="#199473"
    />
    <link rel="manifest" href="${baseUrl}/site.webmanifest" />
    <meta name="theme-color" content="#199473" />
    <link
      rel="apple-touch-startup-image"
      media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)"
      href="${baseUrl}/splash-1179x2556.png"
    />
    <link
      rel="apple-touch-startup-image"
      media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)"
      href="${baseUrl}/splash-1290x2796.png"
    />
    <link
      rel="apple-touch-startup-image"
      media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)"
      href="${baseUrl}/splash-1284x2778.png"
    />
    <link
      rel="apple-touch-startup-image"
      media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)"
      href="${baseUrl}/splash-1170x2532.png"
    />
    <link
      rel="apple-touch-startup-image"
      media="(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)"
      href="${baseUrl}/splash-2048x2732.png"
    />
  </head>`;
}

// ===== PÄÄ =====
async function main() {
  const rawSvg = await fs.readFile(INPUT_SVG, "utf8");

  // SVGO konservatiivisesti — säilytä viewBox ja stylet
  const optimized = optimize(rawSvg, {
    multipass: true,
    plugins: [
      "removeXMLProcInst",
      "removeDoctype",
      "removeComments",
      "removeMetadata",
      { name: "removeXMLNS", active: false },
      { name: "removeViewBox", active: false },
      { name: "removeStyleElement", active: false },
    ],
  }).data;

  // GENEROI KAIKILLE ASSISTENTEILLE
  for (const a of ASSISTANTS) {
    const baseDir = path.join(OUT_BASE, String(a.id));
    await fs.mkdir(baseDir, { recursive: true });

    // Solid-SVG (tausta = assarin väri, logo = valkoinen)
    const solidSvg = makeSolidSvg(optimized, a.color, "#fff");
    await writeFileSafe(path.join(baseDir, "icon.svg"), solidSvg);

    // PNG:t (kaikki peittäviä)
    const bufBySize = {};
    for (const job of RASTERS) {
      const buf = await rasterFromSvgSolid(solidSvg, job.size, a.color);
      await writeFileSafe(path.join(baseDir, job.name), buf);
      bufBySize[job.size] = buf;
    }

    // favicon.ico (16 + 32)
    const icoBuf = await pngToIco([bufBySize[16], bufBySize[32]]);
    await writeFileSafe(path.join(baseDir, "favicon.ico"), icoBuf);

    // Safari pinned tab maski (currentColor)
    const pinnedMask = ensureSvgNamespaceAndViewBox(
      optimized
        .replace(/\sfill="[^"]*"/g, "")
        .replace(
          /<svg([^>]*?)>/,
          (_m, attrs) => `<svg${attrs}><style>*{fill:currentColor}</style>`
        )
    );
    await writeFileSafe(
      path.join(baseDir, "safari-pinned-tab.svg"),
      pinnedMask
    );

    // iOS splashit (portrait)
    for (const d of SPLASH_DEVICES) {
      const splash = await renderSplashSolid(solidSvg, d.pxW, d.pxH, a.color);
      await writeFileSafe(
        path.join(baseDir, `splash-${d.pxW}x${d.pxH}.png`),
        splash
      );
    }

    // Manifest — PNG:t, start_url sisältää ?assistant={id}
    const manifest = {
      name: "Vorte",
      short_name: "Vorte",
      start_url: `/?assistant=${a.id}`,
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      background_color: a.color,
      theme_color: a.color,
      description: "Digital Office with Assistants",
      icons: [
        { src: "favicon-192x192.png", sizes: "192x192", type: "image/png" },
        { src: "favicon-512x512.png", sizes: "512x512", type: "image/png" },
      ],
    };
    await writeFileSafe(
      path.join(baseDir, "site.webmanifest"),
      JSON.stringify(manifest, null, 2)
    );
  }

  // PRINTTAA vain Assistant 3:n HEAD (sellaisenaan)
  console.log(headHtmlForAssistant3());
  console.log(
    "\nOK · Generated assets for 1,2,3 and printed full <head> for Assistant 3."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
