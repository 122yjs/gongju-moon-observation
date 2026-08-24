import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(projectRoot, "styles", "static.css");
const outputPath = path.join(projectRoot, "public", "app.css");
const source = await readFile(sourcePath, "utf8");
const result = await postcss([tailwindcss()]).process(source, {
  from: sourcePath,
  to: outputPath,
});

await writeFile(outputPath, result.css, "utf8");
