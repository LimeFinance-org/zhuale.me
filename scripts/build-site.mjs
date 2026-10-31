import { copyFile, cp, mkdir } from "node:fs/promises";
import { build } from "esbuild";

await build({
  entryPoints: ["src/liquid-glass.js"],
  outfile: "liquid-glass.js",
  bundle: true,
  format: "esm",
  target: ["es2020"],
  minify: true,
  legalComments: "none",
});

await mkdir("worker/public", { recursive: true });
for (const file of ["index.html", "tokens.css", "base.css", "site.css", "liquid-glass.css"]) {
  await copyFile(file, "worker/public/" + file);
}
await cp("assets", "worker/public/assets", { recursive: true, force: true });
await copyFile("liquid-glass.js", "worker/public/liquid-glass.js");
