#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import postcssImport from "postcss-import";
import postcssUrl from "postcss-url";
import postcssPresetEnv from "postcss-preset-env";
import autoprefixer from "autoprefixer";
import cssnano from "cssnano";

const entryFiles = ["./src/styles/base/min.css", "./src/styles/layout/min.css"];
const outputDirectory = "./dist";
const srcRoot = "./src/styles";
const outRoot = path.join(outputDirectory, "styles");

async function ensureDirectory(p) {
  await fs.mkdir(p, { recursive: true });
}

function createProcessor() {
  return postcss([
    postcssImport(),
    postcssUrl({ url: "rebase" }),
    postcssPresetEnv({ stage: 1, features: { "nesting-rules": true } }),
    autoprefixer(),
    cssnano({
      preset: [
        "default",
        { discardComments: { removeAll: true }, normalizeWhitespace: true },
      ],
    }),
  ]);
}

async function processOneFile(inputFilePath) {
  const absIn = path.resolve(inputFilePath);
  const relFromSrc = path.relative(path.resolve(srcRoot), absIn);
  const absOut = path.join(path.resolve(outRoot), relFromSrc);
  await ensureDirectory(path.dirname(absOut));
  const css = await fs.readFile(absIn, "utf8");
  const result = await createProcessor().process(css, {
    from: absIn,
    to: absOut,
    map: false,
  });
  const outCss = result.css.endsWith("\n") ? result.css : result.css + "\n";
  await fs.writeFile(absOut, outCss, "utf8");
}

(async () => {
  try {
    await ensureDirectory(outRoot);
    await Promise.all(entryFiles.map(processOneFile));
  } catch (e) {
    console.error(e?.message ?? String(e));
    process.exit(1);
  }
})();
