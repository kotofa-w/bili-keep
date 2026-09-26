import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = packageJson.version;
const name = "哔哩哔哩历史记录保存与分析";
const targets = ["chrome-mv3", "edge-mv3", "firefox-mv2", "safari-mv2"];

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

for (const target of targets) {
  const targetDir = path.join(root, ".output", target);
  await stat(targetDir);
  const manifest = JSON.parse(await readFile(path.join(targetDir, "manifest.json"), "utf8"));

  assert(manifest.name === name, `${target}: 扩展名称不正确`);
  assert(manifest.version === version, `${target}: 版本号不是 ${version}`);
  assert(!JSON.stringify(manifest).includes("<all_urls>"), `${target}: 不应申请 <all_urls>`);
  assert(manifest.permissions.includes("storage"), `${target}: 缺少 storage 权限`);
  assert(manifest.permissions.includes("cookies"), `${target}: 缺少 cookies 权限`);
  assert(manifest.permissions.includes("alarms"), `${target}: 缺少 alarms 权限`);
  await stat(path.join(targetDir, "PrivacyInfo.xcprivacy"));
  await stat(path.join(targetDir, "LICENSE"));
  await stat(path.join(targetDir, "LICENSE-MIT"));
  await stat(path.join(targetDir, "NOTICE"));

  if (target === "firefox-mv2") {
    const browserSpecificSettings = manifest.browser_specific_settings;
    const gecko = browserSpecificSettings?.gecko;
    assert(gecko?.id === "bilibili-history-sync@rmqg.org", "Firefox ID 不正确");
    assert(gecko?.strict_min_version === "140.0", "Firefox 最低版本不正确");
    assert(
      browserSpecificSettings?.gecko_android?.strict_min_version === "142.0",
      "Firefox Android 最低版本不正确",
    );
    assert(
      gecko?.data_collection_permissions?.optional?.includes("browsingActivity"),
      "Firefox 未声明可选浏览活动数据传输",
    );
  }

  if (target === "safari-mv2") {
    const files = ["background.js"];
    const chunksDir = path.join(targetDir, "chunks");
    const { readdir } = await import("node:fs/promises");
    files.push(
      ...(await readdir(chunksDir))
        .filter((file) => file.endsWith(".js"))
        .map((file) => `chunks/${file}`),
    );

    for (const file of files) {
      const content = await readFile(path.join(targetDir, file), "utf8");
      assert(!/[^\x00-\x7f]/.test(content), `Safari JavaScript 仍含非 ASCII 字符：${file}`);
    }
  }
}

for (const requiredFile of [
  "PRIVACY.md",
  "FIREFOX_REVIEW.md",
  "LICENSE-MIT",
  "NOTICE",
  "public/LICENSE",
  "public/LICENSE-MIT",
  "public/NOTICE",
  "public/PrivacyInfo.xcprivacy",
  "docs/privacy-policy/index.html",
  "docs/privacy-policy/edge/index.html",
  "docs/release/store-listing-zh-CN.md",
  "docs/release/publishing-guide.md",
  "docs/release/manual-test-checklist.md",
  "docs/store-assets/README.md",
  "docs/support/index.html",
]) {
  await stat(path.join(root, requiredFile));
}

for (const browser of ["chrome", "edge", "firefox", "safari"]) {
  await stat(
    path.join(root, ".output", `bilibili-history-save-analysis-${version}-${browser}.zip`),
  );
}
await stat(path.join(root, ".output", `bilibili-history-save-analysis-${version}-sources.zip`));
const checksumFile = await readFile(path.join(root, ".output", "SHA256SUMS.txt"), "utf8");
const checksumEntries = new Map(
  checksumFile
    .trim()
    .split("\n")
    .map((line) => {
      const [hash, file] = line.trim().split(/\s+/, 2);
      return [file, hash];
    }),
);

for (const [file, expectedHash] of checksumEntries) {
  const data = await readFile(path.join(root, ".output", file));
  const actualHash = createHash("sha256").update(data).digest("hex");
  assert(actualHash === expectedHash, `${file}: SHA-256 校验失败`);
}
assert(checksumEntries.size === 5, "SHA256SUMS.txt 应包含五个发布包");

const expectedAssetSizes = new Map([
  ["docs/store-assets/generated/promo-small-440x280.png", [440, 280]],
  ["docs/store-assets/generated/promo-large-1400x560.png", [1400, 560]],
  ["docs/store-assets/generated/store-logo-300.png", [300, 300]],
  ["docs/store-assets/generated/01-history-1280x800.png", [1280, 800]],
  ["docs/store-assets/generated/02-analytics-1280x800.png", [1280, 800]],
  ["docs/store-assets/generated/03-settings-1280x800.png", [1280, 800]],
]);

for (const [file, [expectedWidth, expectedHeight]] of expectedAssetSizes) {
  const png = await readFile(path.join(root, file));
  assert(png.toString("ascii", 1, 4) === "PNG", `${file}: 不是 PNG 文件`);
  assert(png.readUInt32BE(16) === expectedWidth, `${file}: 宽度不正确`);
  assert(png.readUInt32BE(20) === expectedHeight, `${file}: 高度不正确`);
}

console.log("四浏览器构建、manifest、隐私清单、Safari 编码和发布文档检查通过。");
