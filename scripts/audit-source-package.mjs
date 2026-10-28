import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Reuse the ZIP reader already required by WXT; no extra runtime dependency.
const require = createRequire(import.meta.resolve("wxt"));
const JSZip = require("jszip");

export async function auditSourcePackage(data) {
  const zip = await JSZip.loadAsync(data);
  const files = Object.values(zip.files);
  for (const file of files) {
    const name = file.unsafeOriginalName || file.name;
    const parts = name.replaceAll("\\", "/").split("/");
    const forbidden =
      name.startsWith("/") ||
      /^[A-Za-z]:/.test(name) ||
      parts.some((part) =>
        /^(?:\.\.|data|outputs|verification|work|logs|node_modules|\.git|\.cache|\.wxt|\.output|\.vscode|\.mcp\.json|\.env(?:\..*)?|AGENTS\.md|CLAUDE\.md|0[1-4]_(?:PROJECT|STATUS|HISTORY|FILE_INDEX)\.md)$/i.test(
          part,
        ),
      ) ||
      /\.log$/i.test(name) ||
      parts.join("/") === "docs/initial-plan.md";
    if (forbidden) throw new Error(`源码包包含禁止公开的路径：${name}`);
  }
  for (const required of [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.json",
    "wxt.config.ts",
    ".prettierrc",
    "LICENSE",
    "LICENSE-MIT",
    "NOTICE",
    "entrypoints/background.ts",
    "entrypoints/watch.content.ts",
    "utils/preference.ts",
    "public/NOTICE",
    "scripts/audit-source-package.mjs",
  ]) {
    if (!zip.file(required)) throw new Error(`源码包缺少构建或授权文件：${required}`);
  }
  return files.filter((file) => !file.dir).length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const filename = process.argv[2] || `.output/${pkg.name}-${pkg.version}-sources.zip`;
  const count = await auditSourcePackage(await readFile(filename));
  console.log(`源码包公开路径与必要文件检查通过：${count} 个文件`);
}
