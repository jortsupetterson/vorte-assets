import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import sharp from "sharp";
import { optimize as svgoOptimize } from "svgo";
import pngToIco from "png-to-ico";

const SRC_DIR = "./src/images";
const OUT_DIR = "./dist/images";

/** Pakkausasetukset (tasapaino: koko vs. laatu; pre-publish) */
const JPEG_OPTS = { mozjpeg: true, quality: 80 }; // hyvä kompromissi
const PNG_OPTS = { compressionLevel: 9, effort: 9, palette: true };
const WEBP_OPTS = { quality: 75, effort: 6 };
const AVIF_OPTS = { quality: 50, speed: 0 }; // aggressiivinen

/** Tiedostopäätteet */
const EXT = (p) => path.extname(p).toLowerCase();
const IS_SVG = (p) => EXT(p) === ".svg";
const IS_JSON = (p) =>
  EXT(p) === ".json" ||
  EXT(p) === ".webmanifest" ||
  path.basename(p) === "web.manifest";
const IS_ICO = (p) => EXT(p) === ".ico";
const IS_JPEG = (p) => [".jpg", ".jpeg"].includes(EXT(p));
const IS_PNG = (p) => EXT(p) === ".png";
const IS_WEBP = (p) => EXT(p) === ".webp";
const IS_AVIF = (p) => EXT(p) === ".avif";
const IS_TIFF = (p) => [".tif", ".tiff"].includes(EXT(p));
const IS_GIF = (p) => EXT(p) === ".gif"; // animoituja ei kirjoiteta sharpilla -> fallback kopio

const outPathFor = (inputFile) =>
  path.join(OUT_DIR, path.relative(SRC_DIR, inputFile));
const ensureDirFor = async (filePath) =>
  fs.mkdir(path.dirname(filePath), { recursive: true });

/** JSON / manifest minify */
async function minifyJson(inPath) {
  const raw = await fs.readFile(inPath, "utf8");
  const obj = JSON.parse(raw);
  const out = outPathFor(inPath);
  await ensureDirFor(out);
  await fs.writeFile(out, JSON.stringify(obj), "utf8");
}

/** SVG optimointi (säilytetään viewBox) */
async function optimizeSvg(inPath) {
  const svg = await fs.readFile(inPath, "utf8");
  const { data } = svgoOptimize(svg, {
    multipass: true,
    plugins: [
      "preset-default",
      { name: "removeViewBox", active: false },
      { name: "cleanupIds", params: { remove: true, minify: true } },
    ],
  });
  const out = outPathFor(inPath);
  await ensureDirFor(out);
  await fs.writeFile(out, data, "utf8");
}

/** Rasterien optimointi: kirjoita SAMAAN formaattiin */
async function optimizeRasterSameType(inPath) {
  const ext = EXT(inPath);
  const base = sharp(inPath).rotate().withMetadata({ exif: false, icc: false });

  const out = outPathFor(inPath);
  await ensureDirFor(out);

  if (IS_JPEG(inPath)) {
    await base.jpeg(JPEG_OPTS).toFile(out);
  } else if (IS_PNG(inPath)) {
    await base.png(PNG_OPTS).toFile(out);
  } else if (IS_WEBP(inPath)) {
    await base.webp(WEBP_OPTS).toFile(out);
  } else if (IS_AVIF(inPath)) {
    await base.avif(AVIF_OPTS).toFile(out);
  } else if (IS_TIFF(inPath)) {
    // TIFF säilytetään TIFF:nä (harvoin tarpeen prodissa, mutta vaadittu “sama tyyppi”)
    await base.tiff({ quality: 80, compression: "lzw" }).toFile(out);
  } else if (IS_GIF(inPath)) {
    // Animoitu GIF → ei hävitä animaatiota: kopioi
    await fs.copyFile(inPath, out);
  } else {
    // Tuntematon tai ei-tuettu rasteri → kopioi
    await fs.copyFile(inPath, out);
  }
}

/** ICO optimointi: generoi moniresoluutioinen ICO uudelleen PNG-pohjaisena */
async function optimizeIco(inPath) {
  const out = outPathFor(inPath);
  await ensureDirFor(out);

  // Lue lähde ja tee korkearesoluutioinen master
  const master = sharp(inPath).rotate().png({ compressionLevel: 9, effort: 9 });
  const sizes = [16, 32, 48, 64, 128, 256];

  // Renderöi PNG-bufferit eri kokoon
  const pngBuffers = [];
  for (const size of sizes) {
    const buf = await master
      .clone()
      .resize({ width: size, height: size, fit: "cover" })
      .toBuffer();
    pngBuffers.push(buf);
  }

  // Rakenna ICO png-to-ico:lla
  const icoBuffer = await pngToIco(pngBuffers);
  await fs.writeFile(out, icoBuffer);
}

/** Fallback kopiointi */
async function passthrough(inPath) {
  const out = outPathFor(inPath);
  await ensureDirFor(out);
  await fs.copyFile(inPath, out);
}

/** Työnkulku yhdelle tiedostolle */
async function processFile(absIn) {
  try {
    if (IS_JSON(absIn)) return await minifyJson(absIn);
    if (IS_SVG(absIn)) return await optimizeSvg(absIn);
    if (IS_ICO(absIn)) return await optimizeIco(absIn);
    if (
      IS_JPEG(absIn) ||
      IS_PNG(absIn) ||
      IS_WEBP(absIn) ||
      IS_AVIF(absIn) ||
      IS_TIFF(absIn) ||
      IS_GIF(absIn)
    ) {
      return await optimizeRasterSameType(absIn);
    }
    // Kaikki muu: kopioi (esim. txt, license, ai, psd, yms.)
    return await passthrough(absIn);
  } catch (err) {
    console.error(`[optimize] ${absIn}:`, err?.message || err);
    // Virhetilanteessa varmistetaan vähintään kopio
    try {
      await passthrough(absIn);
    } catch {}
  }
}

async function main() {
  const all = await fg([`${SRC_DIR.replace(/\\/g, "/")}/**/*`], {
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
  });

  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  // Rajoitettu rinnakkaisuus
  const concurrency = 8;
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= all.length) break;
      await processFile(all[i]);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
