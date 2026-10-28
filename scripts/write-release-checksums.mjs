import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const baseName = `${packageJson.name}-${packageJson.version}`;
const files = [
  `${baseName}-chrome.zip`,
  `${baseName}-edge.zip`,
  `${baseName}-firefox.zip`,
  `${baseName}-safari.zip`,
  `${baseName}-sources.zip`,
];

const lines = [];
for (const file of files) {
  const data = await readFile(path.join(".output", file));
  const hash = createHash("sha256").update(data).digest("hex");
  lines.push(`${hash}  ${file}`);
}

await writeFile(path.join(".output", "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
console.log("已生成 .output/SHA256SUMS.txt");
