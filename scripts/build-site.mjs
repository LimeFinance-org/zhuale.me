import { copyFile, cp, mkdir } from "node:fs/promises";

await mkdir("worker/public", { recursive: true });
for (const file of ["index.html", "tokens.css", "base.css", "site.css", "liquid-glass.css"]) {
  await copyFile(file, "worker/public/" + file);
}
await cp("assets", "worker/public/assets", { recursive: true, force: true });
