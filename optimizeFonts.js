// optimizeFonts.js  (ESM, Node 18+)
import fg from "fast-glob";
import { execa } from "execa";
import { dirname, extname, join, relative } from "pathe";
import { mkdirp } from "mkdirp";
import { stat } from "node:fs/promises";

const SRC_DIR = "./src/fonts";
const OUT_DIR = "./dist/fonts";
const SUBSET = (process.env.SUBSET || "").trim(); // esim. "U+0000-00FF,U+0100-024F"
const SUPPORTED_EXTS = new Set([".ttf", ".otf", ".woff", ".woff2"]);

function outPathFor(inFile) {
  const rel = relative(SRC_DIR, inFile); // esim. a/b/Inter-VariableFont_opsz,wght.ttf
  const baseNoExt = rel.slice(0, rel.length - extname(rel).length);
  return join(OUT_DIR, `${baseNoExt}.woff2`); // → dist/fonts/a/b/Inter-VariableFont_opsz,wght.woff2
}

function buildArgs(inFile, outFile) {
  const args = [
    "fontTools.subset", // ajetaan modulina → ei PATH-riippuvuutta
    inFile,
    `--output-file=${outFile}`,
    "--flavor=woff2",
    "--no-hinting",
    "--layout-features=*",
    // ÄLÄ pudota STAT (variable-fontit tarvitsevat sen). DSIG/FFTM voidaan pudottaa.
    "--drop-tables+=FFTM,DSIG",
  ];
  if (SUBSET) args.push(`--unicodes=${SUBSET}`);
  else args.push("--glyphs=*");
  return args;
}

async function isUpToDate(src, out) {
  try {
    const [s, o] = await Promise.all([stat(src), stat(out)]);
    return s.mtimeMs <= o.mtimeMs;
  } catch {
    return false;
  }
}

async function main() {
  const entries = await fg(`${SRC_DIR}/**/*`, { dot: false });
  let processed = 0;

  for (const inFile of entries) {
    const ext = extname(inFile).toLowerCase();
    if (!SUPPORTED_EXTS.has(ext)) continue;

    const outFile = outPathFor(inFile);
    if (await isUpToDate(inFile, outFile)) continue;

    await mkdirp(dirname(outFile));

    const py = process.platform === "win32" ? "python" : "python3";
    const args = buildArgs(inFile, outFile);

    try {
      await execa(py, ["-m", ...args], { stdio: "inherit" });
      processed++;
    } catch (err) {
      console.error(`[font-optimize] epäonnistui: ${inFile}`);
      if (err?.message) console.error(err.message);
      // jatka seuraavaan
    }
  }

  console.log(`[font-optimize] Valmis. Optimoituja fontteja: ${processed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
