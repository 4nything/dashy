import sharp from "sharp";
import { readFileSync } from "node:fs";

const svg = readFileSync(new URL("./source.svg", import.meta.url));

await sharp(svg, { density: 384 })
  .resize(1024, 1024)
  .png()
  .toFile(new URL("./source.png", import.meta.url).pathname.replace(/^\//, ""));

console.log("wrote source.png (1024x1024)");
