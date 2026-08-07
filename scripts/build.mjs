// Build-time minification pipeline (Fix #6: Minify JS/CSS + Reduce Unused CSS)
// Run: npm run build
//
// What this does:
//   1. Minifies every first-party js/*.js file -> js/*.min.js (esbuild)
//      - preserves ES module files (admin.js, firebase-config.js) as ESM output
//      - minifies classic scripts as IIFE-safe plain JS
//   2. Re-minifies css/main.css and css/components.css -> css/*.min.css
//      using esbuild's CSS minifier (safe, no unused-rule removal)
//   3. Runs PurgeCSS across all .html + .js files to strip *unused* CSS
//      rules from the minified output (this is the "Reduce Unused CSS" part)
//   4. Prints a before/after size report
//
// NOTE: This script only regenerates js/*.min.js and css/*.min.css.
// It does NOT rewrite <script>/<link> tags in HTML - do that once,
// then every future `npm run build` just refreshes the built files in place.

import { build } from "esbuild";
import { PurgeCSS } from "purgecss";
import { readFileSync, writeFileSync, statSync, readdirSync } from "fs";
import { join } from "path";

const JS_DIR = "js";
const CSS_DIR = "css";

// Files that are real ES modules (use import/export) - everything else is
// treated as a classic <script defer> file.
const ESM_FILES = new Set(["admin.js", "firebase-config.js"]);

function kb(bytes) {
  return (bytes / 1024).toFixed(1) + " KiB";
}

async function minifyJS() {
  const files = readdirSync(JS_DIR).filter(
    (f) => f.endsWith(".js") && !f.endsWith(".min.js")
  );

  let totalBefore = 0;
  let totalAfter = 0;
  const rows = [];

  for (const file of files) {
    const inPath = join(JS_DIR, file);
    const outPath = join(JS_DIR, file.replace(/\.js$/, ".min.js"));
    const before = statSync(inPath).size;

    const isESM = ESM_FILES.has(file);
    await build({
      entryPoints: [inPath],
      outfile: outPath,
      minify: true,
      bundle: false, // each file already loaded standalone via <script> tags
      // IMPORTANT: classic (non-module) files must NOT be wrapped in an
      // IIFE. Several of them declare top-level `const Foo = ...` /
      // `function Foo(){}` that other inline <script> blocks and other
      // page scripts reference as an implicit global (e.g. PageLoader,
      // CategoryChips) - not via `window.Foo =`. esbuild's "iife" format
      // wraps the whole file in `(() => {...})()`, which both hides that
      // global from the rest of the page AND makes the now-unreferenced
      // top-level binding look dead, so the minifier deletes it entirely.
      // Leaving format unset keeps output as flat top-level statements,
      // same scoping as the original <script> tag.
      format: isESM ? "esm" : undefined,
      treeShaking: false,
      // esm files (admin.js, firebase-config.js) use top-level await, which
      // needs a newer target; classic <script defer> files stay on a wider
      // (es2019) target for broader compatibility.
      target: isESM ? ["es2022"] : ["es2019"],
      legalComments: "none",
      logLevel: "silent",
    });

    const after = statSync(outPath).size;
    totalBefore += before;
    totalAfter += after;
    rows.push({ file, before, after });
  }

  return { rows, totalBefore, totalAfter };
}

async function minifyAndPurgeCSS() {
  const cssFiles = ["main.css", "components.css"];
  const results = [];

  for (const file of cssFiles) {
    const inPath = join(CSS_DIR, file);
    const outPath = join(CSS_DIR, file.replace(/\.css$/, ".min.css"));
    const before = statSync(inPath).size;

    // Step A: purge unused selectors against every HTML + JS file (JS is
    // scanned too, since some class names are toggled/added at runtime,
    // e.g. classList.add("...") strings).
    const purgeResult = await new PurgeCSS().purge({
      content: [
        "*.html",
        `${JS_DIR}/*.js`,
        "partials/*.html",
      ],
      css: [inPath],
      safelist: {
        // Keep anything toggled dynamically that PurgeCSS's static
        // analysis might miss (data-state attrs, aria-*, JS-built class
        // strings via template literals, third-party widget classes).
        standard: [/^is-/, /^has-/, /^active/, /^open/, /^show/, /^hide/, /^visible/, /^disabled/, /^loading/, /^selected/, /^error/, /^success/, /^warning/, /^dragging/, /^expanded/, /^collapsed/],
        deep: [/^swiper/, /^fuse-/, /^toast/, /^modal/, /^overlay/, /^tooltip/],
        greedy: [/^js-/, /^data-/],
      },
    });
    const purgedCSS = purgeResult[0].css;

    // Step B: minify the purged CSS with esbuild's CSS minifier.
    const minified = await build({
      stdin: {
        contents: purgedCSS,
        loader: "css",
      },
      write: false,
      minify: true,
      logLevel: "silent",
    });

    const outCSS = minified.outputFiles[0].text;
    writeFileSync(outPath, outCSS);
    const after = statSync(outPath).size;
    results.push({ file, before, after });
  }

  return results;
}

async function minifyCriticalCSS() {
  // Inlined above-the-fold CSS (css/critical-source.css -> css/critical.min.css,
  // pasted directly into every page's <head>). Minify only - no purging,
  // since this file is already a small hand-curated subset.
  const inPath = join(CSS_DIR, "critical-source.css");
  const outPath = join(CSS_DIR, "critical.min.css");
  const before = statSync(inPath).size;
  const src = readFileSync(inPath, "utf8");

  const minified = await build({
    stdin: { contents: src, loader: "css" },
    write: false,
    minify: true,
    logLevel: "silent",
  });

  writeFileSync(outPath, minified.outputFiles[0].text);
  const after = statSync(outPath).size;
  return { before, after };
}

async function main() {
  console.log("Building js/*.min.js ...\n");
  const js = await minifyJS();
  for (const r of js.rows) {
    console.log(`  ${r.file.padEnd(28)} ${kb(r.before).padStart(10)} -> ${kb(r.after).padStart(10)}`);
  }
  console.log(`\n  JS total: ${kb(js.totalBefore)} -> ${kb(js.totalAfter)} (saved ${kb(js.totalBefore - js.totalAfter)})\n`);

  console.log("Building css/*.min.css (minify + purge unused rules) ...\n");
  const css = await minifyAndPurgeCSS();
  let cssBefore = 0, cssAfter = 0;
  for (const r of css) {
    console.log(`  ${r.file.padEnd(28)} ${kb(r.before).padStart(10)} -> ${kb(r.after).padStart(10)}`);
    cssBefore += r.before;
    cssAfter += r.after;
  }
  console.log(`\n  CSS total: ${kb(cssBefore)} -> ${kb(cssAfter)} (saved ${kb(cssBefore - cssAfter)})\n`);

  console.log("Building css/critical.min.css from css/critical-source.css ...\n");
  const crit = await minifyCriticalCSS();
  console.log(`  critical-source.css -> critical.min.css   ${kb(crit.before).padStart(10)} -> ${kb(crit.after).padStart(10)}\n`);

  console.log("Done. Deploy js/*.min.js and css/*.min.css alongside the source files.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
