// Isolated extension integration test. All Bilibili pages/API responses are fixtures.
// Run after pnpm build, with PLAYWRIGHT_MODULE and BROWSER_EXECUTABLE if not on PATH.
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(import.meta.dirname, "..");
const reports = path.resolve(process.env.SMOKE_REPORT_DIR || path.join(root, ".output", "smoke"));
await mkdir(reports, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), "bili-keep-test-"));
const extension = path.join(root, ".output", "chrome-mv3");
const options = {
  headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
};
const checks = [];
const check = (name, condition) => {
  assert.ok(condition, name);
  checks.push(name);
  console.log(`PASS ${name}`);
};
let context;
async function start() {
  context = await chromium.launchPersistentContext(profile, options);
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 10000 });
  return worker;
}
async function snapshot(worker) {
  return worker.evaluate(async () => {
    if (!(await indexedDB.databases()).some((database) => database.name === "biliKeepLibrary"))
      return { sessions: [], decisions: [] };
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("biliKeepLibrary", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!db.objectStoreNames.contains("sessions")) {
      db.close();
      return { sessions: [], decisions: [] };
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["sessions", "decisions"]);
      const sessions = tx.objectStore("sessions").getAll();
      const decisions = tx.objectStore("decisions").getAll();
      tx.oncomplete = () => {
        resolve({ sessions: sessions.result, decisions: decisions.result });
        db.close();
      };
      tx.onerror = () => {
        reject(tx.error);
        db.close();
      };
    });
  });
}
async function eventually(predicate, label) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timeout: ${label}`);
}
try {
  let worker = await start();
  const id = new URL(worker.url()).hostname;
  // Mock only the remote service boundary; production content/background/DB/UI run unchanged.
  await worker.evaluate(() => {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      let data;
      if (url.pathname.endsWith("/view"))
        data = {
          title: "【模拟验收】参数化建模教程",
          owner: { name: "模拟UP" },
          pic: "http://i0.hdslb.com/__bili_keep_fixture__/cover.svg",
          pages: [
            { page: 1, cid: 123, duration: 120, part: "第一P" },
            { page: 2, cid: 456, duration: 120, part: "同长第二P" },
          ],
        };
      else if (url.pathname.endsWith("has/like")) data = 1;
      else if (url.pathname.endsWith("/coins")) data = { multiply: 2 };
      else if (url.pathname.endsWith("/favoured")) data = { favoured: true };
      else throw new Error(`Unexpected remote request: ${url}`);
      return new Response(JSON.stringify({ code: 0, data }), {
        headers: { "Content-Type": "application/json" },
      });
    };
  });
  await context.route("https://i0.hdslb.com/__bili_keep_fixture__/cover.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#183b56"/><path d="M0 300 220 130 400 250 640 70V360H0" fill="#2b637b"/><circle cx="495" cy="95" r="40" fill="#f4c56a"/><text x="36" y="75" fill="white" font-size="34">SIMULATED VIDEO</text><text x="36" y="320" fill="white" font-size="26">Bili Keep · UI test</text></svg>',
    }),
  );
  const pcmBytes = 120 * 8000 * 2;
  const wav = Buffer.alloc(44 + pcmBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + pcmBytes, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcmBytes, 40);
  await context.route("https://www.bilibili.com/__bili_keep_fixture__/**", (route) => {
    const range = route
      .request()
      .headers()
      .range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
    return route.fulfill({
      status: range ? 206 : 200,
      contentType: "audio/wav",
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${wav.length}` } : {}),
      },
      body: wav.subarray(start, end + 1),
    });
  });
  await context.route("https://www.bilibili.com/video/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>模拟播放器验收</title><div class='bpx-player-video-wrap'><video muted preload='auto' src='/__bili_keep_fixture__/p1.wav'></video></div>",
    }),
  );
  const player = await context.newPage();
  await player.addInitScript(() => {
    const video = () => document.querySelector("video");
    window.fixture = {
      play: async () => {
        video().playbackRate = 2;
        await video().play();
      },
      pause: () => video().pause(),
      seek: (value) =>
        new Promise((resolve) => {
          video().addEventListener("seeked", resolve, { once: true });
          video().currentTime = value;
        }),
      navigate: () => history.pushState(null, "", "?p=2"),
      loadSecondPart: () =>
        new Promise((resolve) => {
          video().addEventListener("loadedmetadata", resolve, { once: true });
          video().src = "/__bili_keep_fixture__/p2.wav";
          video().load();
        }),
    };
  });
  await player.goto("https://www.bilibili.com/video/BV1xx411c7mD/");
  await player.bringToFront();
  await eventually(async () => (await snapshot(worker)).sessions.length === 1, "initial session");
  await player.evaluate(() => window.fixture.play());
  await player.waitForTimeout(2300);
  await player.evaluate(() => window.fixture.pause());
  await eventually(
    async () => (await snapshot(worker)).sessions[0].foregroundSeconds > 1,
    "played time persisted",
  );
  let data = await snapshot(worker);
  check(
    "foreground playback persists through real extension messaging",
    data.sessions[0].foregroundSeconds > 1,
  );
  check(
    "2x content coverage exceeds real wall time",
    data.sessions[0].intervals.reduce((sum, [a, b]) => sum + b - a, 0) >
      data.sessions[0].foregroundSeconds * 1.8,
  );
  await player.evaluate(() => window.fixture.seek(110));
  await player.waitForTimeout(1100);
  await player.evaluate(() => window.fixture.play());
  await player.waitForTimeout(1300);
  await player.evaluate(() => window.fixture.pause());
  await eventually(
    async () => (await snapshot(worker)).sessions[0].position > 110,
    "seek position saved",
  );
  data = await snapshot(worker);
  check(
    "seek-to-end does not create artificial coverage",
    data.sessions[0].intervals.reduce((sum, [a, b]) => sum + b - a, 0) < 15,
  );
  await player.evaluate(() => {
    window.fixture.play();
    window.fixture.navigate();
  });
  await player.waitForTimeout(2200);
  check(
    "same-duration SPA part waits for new media identity",
    !(await snapshot(worker)).sessions.some((session) => session.part === 2),
  );
  await player.evaluate(async () => {
    await window.fixture.loadSecondPart();
    await window.fixture.play();
  });
  await player.waitForTimeout(2300);
  await player.evaluate(() => window.fixture.pause());
  await eventually(
    async () =>
      (await snapshot(worker)).sessions.some(
        (session) => session.part === 2 && session.foregroundSeconds > 0,
      ),
    "second part persisted",
  );
  data = await snapshot(worker);
  check(
    "second part has distinct CID and separate coverage",
    data.sessions.some((session) => session.cid === "456"),
  );
  const beforePause = data.sessions.find((session) => session.part === 2).foregroundSeconds;
  await player.evaluate(() => window.fixture.play());
  await player.waitForTimeout(1300);
  await worker.evaluate(() => chrome.storage.local.set({ biliKeepTrackingEnabled: false }));
  await eventually(
    async () =>
      (await snapshot(worker)).sessions.find((session) => session.part === 2).foregroundSeconds >
      beforePause,
    "pause flush",
  );
  const stopped = await snapshot(worker);
  check(
    "pause flushes tail instead of rejecting final snapshot",
    stopped.sessions.find((session) => session.part === 2).foregroundSeconds > beforePause,
  );
  await player.waitForTimeout(1300);
  check(
    "disabled collector stops accumulating sessions",
    JSON.stringify(await snapshot(worker)) === JSON.stringify(stopped),
  );
  await player.close();

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/my-history.html`);
  await page.getByRole("heading", { name: "Bili Keep · 喜好归档" }).waitFor();
  await page
    .getByRole("button", { name: "查看详情：【模拟验收】参数化建模教程", exact: true })
    .waitFor();
  const cover = page.locator(
    'article img[src="https://i0.hdslb.com/__bili_keep_fixture__/cover.svg"]',
  );
  await cover.waitFor();
  await eventually(
    async () => cover.evaluate((image) => image.complete && image.naturalWidth > 0),
    "cover image loads",
  );
  check("legacy HTTP cover is rendered as a loaded HTTPS image", await cover.isVisible());
  check(
    "compact card hides notes and detailed evidence until opened",
    (await page.getByRole("textbox", { name: "我的备注" }).count()) === 0,
  );
  const ring = page.locator('article [role="img"]').first();
  await ring.hover();
  await page.getByRole("tooltip").waitFor({ state: "visible" });
  check(
    "ring hover exposes score contributions and model weights",
    (await page.getByRole("tooltip").innerText()).includes("覆盖"),
  );
  const tooltipBounds = await page.getByRole("tooltip").boundingBox();
  check(
    "card tooltip stays inside the viewport",
    tooltipBounds.x >= 0 && tooltipBounds.x + tooltipBounds.width <= page.viewportSize().width,
  );
  await ring.focus();
  await page.mouse.move(0, 0);
  check("ring data is accessible from keyboard focus", await page.getByRole("tooltip").isVisible());
  await page.getByRole("button", { name: "查看详情", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  check(
    "card click opens detailed view",
    await page.getByRole("textbox", { name: "我的备注" }).isVisible(),
  );
  await page.getByRole("dialog").locator('[role="img"]').hover();
  const detailTooltip = await page.getByRole("tooltip").boundingBox();
  const dialogBounds = await page.getByRole("dialog").boundingBox();
  check(
    "detail tooltip is not clipped by the dialog",
    detailTooltip.y >= dialogBounds.y &&
      detailTooltip.y + detailTooltip.height <= dialogBounds.y + dialogBounds.height,
  );
  await page.getByRole("textbox", { name: "我的备注" }).fill("尚未保存的备注");
  await page.waitForTimeout(5200);
  check(
    "automatic refresh preserves an unsaved note",
    (await page.getByRole("textbox", { name: "我的备注" }).inputValue()) === "尚未保存的备注",
  );
  check(
    "automatic refresh keeps the note editor focused",
    await page
      .getByRole("textbox", { name: "我的备注" })
      .evaluate((element) => element === document.activeElement),
  );
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await eventually(
    async () =>
      page
        .getByRole("button", { name: "查看详情", exact: true })
        .evaluate((button) => button === document.activeElement),
    "detail focus restoration",
  );
  check(
    "Escape closes detail and returns focus to the card",
    await page
      .getByRole("button", { name: "查看详情", exact: true })
      .evaluate((button) => button === document.activeElement),
  );
  await page.getByRole("button", { name: "查看详情", exact: true }).click();
  await page.getByRole("textbox", { name: "我的备注" }).fill("仅模拟验收数据：回找建模教程");
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await eventually(
    async () => (await snapshot(worker)).decisions[0]?.note.includes("回找建模教程"),
    "note persistence",
  );
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索资料库" }).fill("回找建模教程");
  check("library searches saved notes", (await page.locator("article").count()) === 1);
  await page.getByRole("button", { name: "查看详情", exact: true }).click();
  await page.getByRole("button", { name: "排除", exact: true }).click();
  await eventually(
    async () => (await snapshot(worker)).decisions[0]?.status === "exclude",
    "manual exclude",
  );
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.getByRole("combobox", { name: "筛选状态" }).selectOption("exclude");
  await page.getByRole("button", { name: "查看详情", exact: true }).click();
  await page.getByRole("button", { name: "保留", exact: true }).click();
  await eventually(
    async () => (await snapshot(worker)).decisions[0]?.status === "keep",
    "manual keep",
  );
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.getByRole("combobox", { name: "筛选状态" }).selectOption("keep");
  await page.locator("article").waitFor();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出备份", exact: true }).click();
  const download = await downloadEvent;
  const backupPath = path.join(reports, "fixture-backup.json");
  await download.saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, "utf8"));
  check(
    "export includes accumulated sessions and manual notes",
    backup.sessions.length === 2 && backup.decisions[0].note.includes("回找"),
  );
  await page.getByLabel("选择喜好归档备份").setInputFiles(backupPath);
  await eventually(
    async () => (await page.getByText("备份已合并，原有记录已保留").count()) > 0,
    "restore feedback",
  );
  check("reimport is idempotent", (await snapshot(worker)).sessions.length === 2);
  const denied = await page.evaluate(() =>
    chrome.runtime.sendMessage({ action: "capture.save", session: {} }),
  );
  check("background rejects non-video-page capture messages", denied.success === false);
  check("library loads without JS errors", errors.length === 0);
  await page.getByText("备份已合并，原有记录已保留").waitFor({ state: "hidden", timeout: 10000 });
  await page.screenshot({ path: path.join(reports, "library-fixture.png"), fullPage: true });
  await page.getByRole("button", { name: "查看详情", exact: true }).click();
  await page.screenshot({ path: path.join(reports, "library-detail-fixture.png"), fullPage: true });
  await context.close();
  worker = await start();
  check(
    "library survives browser restart",
    (await snapshot(worker)).decisions[0]?.note.includes("回找建模教程"),
  );
  await writeFile(
    path.join(reports, "browser-smoke.json"),
    JSON.stringify(
      { passed: true, fixtureOnly: true, browser: "Chromium-based isolated profile", checks },
      null,
      2,
    ),
  );
} catch (error) {
  const currentWorker = context?.serviceWorkers()[0];
  const diagnostics = currentWorker
    ? {
        storage: await currentWorker.evaluate(() => chrome.storage.local.get()),
        snapshot: await snapshot(currentWorker),
      }
    : {};
  await writeFile(
    path.join(reports, "browser-smoke.json"),
    JSON.stringify(
      { passed: false, fixtureOnly: true, checks, error: String(error), diagnostics },
      null,
      2,
    ),
  );
  throw error;
} finally {
  if (context) await context.close();
  if (
    path.dirname(profile) !== path.resolve(tmpdir()) ||
    !path.basename(profile).startsWith("bili-keep-test-")
  )
    throw new Error("Unexpected test profile path");
  await rm(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
}
