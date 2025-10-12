import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import sharp from "sharp";
import { optimize as svgoOptimize } from "svgo";

const SRC_DIR = "./src/images";
const OUT_DIR = "./dist/images";

// Laatu- ja nopeusparametrit (pre-publish: maksimi pakkaus)
const AVIF_OPTS = { quality: 50, speed: 0 }; // paras koko/laatu
const WEBP_OPTS = { quality: 75, effort: 6 }; // hyvä kompromissi
const JPEG_OPTS = { mozjpeg: true, quality: 80 }; // fallback/arkistokopio
const PNG_OPTS = { compressionLevel: 9 };

// Tuetut tyypit
const RASTER_EXT = new Set([".jpg", ".jpeg", ".png"]);
const LOSSY_EXT = new Set([".jpg", ".jpeg"]); // joista tehdään myös optimoitu alkuperäinen
const SVG_EXT = new Set([".svg"]);

function outPathFor(inputFile, extOverride = null) {
  const rel = path.relative(SRC_DIR, inputFile);
  const target = extOverride
    ? path.join(OUT_DIR, rel).replace(/\.[^.]+$/, extOverride)
    : path.join(OUT_DIR, rel);
  return target;
}

async function ensureDirFor(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function optimizeSvg(absIn) {
  const svg = await fs.readFile(absIn, "utf8");
  const { data } = svgoOptimize(svg, {
    multipass: true,
    plugins: [
      "preset-default",
      { name: "removeViewBox", active: false }, // säilytä viewBox responsiivisuutta varten
      { name: "cleanupIds", params: { remove: true, minify: true } },
    ],
  });
  const outSvg = outPathFor(absIn);
  await ensureDirFor(outSvg);
  await fs.writeFile(outSvg, data, "utf8");
}

async function optimizeRaster(absIn) {
  const ext = path.extname(absIn).toLowerCase();
  const base = sharp(absIn).rotate().withMetadata({ exif: false, icc: false });

  // AVIF
  {
    const outAvif = outPathFor(absIn, ".avif");
    await ensureDirFor(outAvif);
    await base.clone().avif(AVIF_OPTS).toFile(outAvif);
  }
  // WebP
  {
    const outWebp = outPathFor(absIn, ".webp");
    await ensureDirFor(outWebp);
    await base.clone().webp(WEBP_OPTS).toFile(outWebp);
  }
  // Optimoitu alkuperäinen formaatti
  const outOrig = outPathFor(absIn, ext);
  await ensureDirFor(outOrig);
  if (LOSSY_EXT.has(ext)) {
    await base.clone().jpeg(JPEG_OPTS).toFile(outOrig);
  } else if (ext === ".png") {
    await base.clone().png(PNG_OPTS).toFile(outOrig);
  } else {
    // fallback: kopioi sellaisenaan (ei pitäisi osua)
    await fs.copyFile(absIn, outOrig);
  }
}

async function main() {
  const patterns = [`${SRC_DIR.replace(/\\/g, "/")}/**/*.{jpg,jpeg,png,svg}`];
  const files = await fg(patterns, { dot: false, onlyFiles: true });

  // Pieni rinnakkaisuus ilman muistipiikkejä
  const concurrency = 8;
  let index = 0;

  async function worker() {
    while (index < files.length) {
      const i = index++;
      const absIn = files[i];

      const ext = path.extname(absIn).toLowerCase();
      try {
        if (SVG_EXT.has(ext)) {
          await optimizeSvg(absIn);
        } else if (RASTER_EXT.has(ext)) {
          await optimizeRaster(absIn);
        }
      } catch (err) {
        console.error(`[optimize] ${absIn}:`, err?.message || err);
      }
    }
  }

  await fs.rm(OUT_DIR, { recursive: true, force: true }); // puhdas build
  await fs.mkdir(OUT_DIR, { recursive: true });
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
