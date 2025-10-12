// favicons.js — ei leikkaa mitään
import fs from "fs/promises";
import path from "node:path";
import sharp from "sharp";
import { optimize } from "svgo";
import pngToIco from "png-to-ico";

const ASSISTANTS = [
  { id: 1, color: "#000000" },
  { id: 2, color: "#d58a8b" },
  { id: 3, color: "#0b4f60" },
];

const RASTERS = [
  { name: "favicon-16x16.png", size: 16 },
  { name: "favicon-32x32.png", size: 32 },
  { name: "favicon-192x192.png", size: 192 },
  { name: "favicon-512x512.png", size: 512 },
  { name: "apple-touch-icon.png", size: 180 },
];

// Kirjoita icon.svg raakana? true = käytä alkuperäistä, false = kevyt svgo (ei viewBox-muutoksia)
const RAW_SVG_FOR_ICON = true;

const writeFileSafe = async (p, data) => {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, data);
};

const toMonochromeCurrentColor = (svg) => {
  let out = svg.replace(/\sfill="[^"]*"/g, "");
  if (out.includes("<style"))
    out = out.replace(/<style[^>]*>/, (m) => `${m}\n*{fill:currentColor}`);
  else
    out = out.replace(
      /<svg([^>]*?)>/,
      (_m, a) => `<svg${a}><style>*{fill:currentColor}</style>`
    );
  return out;
};

// Ei trimmiä. Ei extractiä. Ei automaattista paddingin poistoa.
async function rasterFromSvg(svgString, outSize, flattenBgHex = null) {
  const background = flattenBgHex
    ? flattenBgHex
    : { r: 0, g: 0, b: 0, alpha: 0 };

  const buf = await sharp(Buffer.from(svgString), {
    density: Math.max(384, outSize * 3), // terävä vektorirender
    limitInputPixels: false,
  })
    .resize(outSize, outSize, {
      fit: "contain", // säilytä kuvasuhde; ei rajausta
      background,
      kernel: "lanczos3",
      withoutEnlargement: false,
    })
    .png({ compressionLevel: 9, effort: 9 }) // ei palette-kvantisointia -> ei geometrian muutoksia
    .toBuffer();

  // Apple-touch vaatii tasaisen taustan
  if (flattenBgHex) {
    return await sharp(buf)
      .flatten({ background: flattenBgHex })
      .png({ compressionLevel: 9, effort: 9 })
      .toBuffer();
  }
  return buf;
}

async function buildOne({ id, color }) {
  const baseDir = `./src/images/favicons/${id}/`;
  const inputSvgPath = path.join(baseDir, "logo.svg");
  const rawSvg = await fs.readFile(inputSvgPath, "utf8");

  // icon.svg: valitse raaka tai varovasti optimoitu (ilman viewBox/transform muutoksia)
  const iconSvg = RAW_SVG_FOR_ICON
    ? rawSvg
    : optimize(rawSvg, {
        multipass: true,
        plugins: [
          { name: "removeMetadata", active: true },
          { name: "removeXMLProcInst", active: true },
          { name: "removeDoctype", active: true },
          { name: "removeComments", active: true },
          { name: "removeViewBox", active: false }, // ÄLÄ KOSKE
          { name: "cleanupIDs", active: false }, // ÄLÄ RIKO CLIP/MASK
          { name: "convertPathData", active: false },
          { name: "mergePaths", active: false },
          { name: "moveElemsAttrsToGroup", active: false },
          { name: "moveGroupAttrsToElems", active: false },
        ],
      }).data;

  await writeFileSafe(path.join(baseDir, "icon.svg"), iconSvg);

  // Rasterit: AINA alkuperäisestä raaka-SVG:stä -> ei optimoinnin sivuvaikutuksia
  const pngBuffers = {};
  for (const job of RASTERS) {
    const buf =
      job.name === "apple-touch-icon.png"
        ? await rasterFromSvg(rawSvg, job.size, "#ffffff")
        : await rasterFromSvg(rawSvg, job.size, null);
    await writeFileSafe(path.join(baseDir, job.name), buf);
    pngBuffers[job.size] = buf;
  }

  // ICO 16/32
  const icoBuf = await pngToIco([pngBuffers[16], pngBuffers[32]]);
  await writeFileSafe(path.join(baseDir, "favicon.ico"), icoBuf);

  // Safari pinned (monokromaattinen currentColor)
  const pinned = toMonochromeCurrentColor(iconSvg);
  await writeFileSafe(path.join(baseDir, "safari-pinned-tab.svg"), pinned);

  // Manifest
  const manifest = {
    name: "Vorte, Digital Office with Assistants",
    short_name: "Vorte",
    start_url: "https://vorte.app?pwa",
    orientation: "portrait",
    description: "",
    icons: [
      { src: "favicon-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "favicon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    theme_color: color,
    background_color: "#ffffff",
    display: "standalone",
  };
  await writeFileSafe(
    path.join(baseDir, "site.webmanifest"),
    JSON.stringify(manifest, null, 2)
  );
}

(async () => {
  for (const a of ASSISTANTS) await buildOne(a);
  console.log("OK · favicons generated for assistants 1, 2, 3 (no-crop).");
})();
