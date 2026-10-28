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
      const req = indexedDB.open("biliKeepLibrary");
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
async function markerData(worker) {
  return worker.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("biliKeepLibrary");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(["markers", "videoTags"]);
        const markers = tx.objectStore("markers").getAll();
        const tags = tx.objectStore("videoTags").getAll();
        tx.oncomplete = () => resolve({ markers: markers.result, tags: tags.result });
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
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
      if (url.pathname.endsWith("/view")) {
        if (globalThis.markerFixtureMode === "reordered")
          data.pages = [
            { ...data.pages[1], page: 1 },
            { ...data.pages[0], page: 2 },
          ];
        if (globalThis.markerFixtureMode === "missing")
          data.pages = data.pages.filter((part) => part.cid !== 456);
        if (globalThis.markerFixtureMode === "shortened")
          data.pages = data.pages.map((part) =>
            part.cid === 456 ? { ...part, duration: 0.5 } : part,
          );
      }
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
  let popup = await context.newPage();
  await player.bringToFront();
  await popup.goto(`chrome-extension://${new URL(worker.url()).hostname}/popup.html`);
  await popup.getByText(/读取失败/).waitFor();
  check(
    "marker refuses a switching same-duration part",
    (await markerData(worker)).markers.length === 0,
  );
  check(
    "unbound time point cannot be edited or saved",
    await popup.getByRole("button", { name: "保存当前时间点", exact: true }).isDisabled(),
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
  await player.bringToFront();
  await popup
    .getByRole("button", { name: "重新取当前时间", exact: true })
    .evaluate((button) => button.click());
  await eventually(
    async () =>
      !(await popup.getByRole("button", { name: "保存当前时间点", exact: true }).isDisabled()),
    "time point fixed",
  );
  const frozenTimeLabel = await popup.getByLabel("将保存的时间点", { exact: true }).innerText();
  await popup.getByRole("textbox", { name: "时间点说明", exact: true }).fill("单点标记：精彩内容");
  await eventually(
    async () =>
      JSON.stringify(await worker.evaluate(() => chrome.storage.session.get(null))).includes(
        "单点标记：精彩内容",
      ),
    "popup draft stored before close",
  );
  await player.evaluate(() => window.fixture.seek(40));
  check(
    "typing a note does not move the frozen time point",
    (await popup.getByLabel("将保存的时间点", { exact: true }).innerText()) === frozenTimeLabel,
  );
  await popup.bringToFront();
  await popup
    .getByRole("button", { name: "重新取当前时间", exact: true })
    .evaluate((button) => button.click());
  await popup.getByText(/读取失败/).waitFor();
  check(
    "failed recapture keeps the prior note and disables save",
    (await popup.getByRole("textbox", { name: "时间点说明", exact: true }).inputValue()) ===
      "单点标记：精彩内容" &&
      (await popup.getByRole("button", { name: "保存当前时间点", exact: true }).isDisabled()),
  );
  await popup.close();
  popup = await context.newPage();
  await player.bringToFront();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await eventually(
    async () =>
      !(await popup.getByRole("button", { name: "保存当前时间点", exact: true }).isDisabled()),
    "popup draft restored",
  );
  check(
    "reopened popup restores both the note and original frozen time",
    (await popup.getByRole("textbox", { name: "时间点说明", exact: true }).inputValue()) ===
      "单点标记：精彩内容" &&
      (await popup.getByLabel("将保存的时间点", { exact: true }).innerText()) === frozenTimeLabel,
  );
  await popup.screenshot({ path: path.join(reports, "popup-fixed-fixture.png"), fullPage: true });
  await popup
    .getByRole("button", { name: "保存当前时间点", exact: true })
    .evaluate((button) => button.click());
  await popup.getByText("时间标记已保存，可在喜好资料库查看。", { exact: true }).waitFor();
  const savedMarker = (await markerData(worker)).markers[0];
  check("save uses the frozen time instead of the later play position", savedMarker.position < 40);
  await eventually(
    async () =>
      !JSON.stringify(await worker.evaluate(() => chrome.storage.session.get(null))).includes(
        "单点标记：精彩内容",
      ),
    "saved popup draft removed",
  );
  check(
    "successful save clears the matching popup draft",
    !JSON.stringify(await worker.evaluate(() => chrome.storage.session.get(null))).includes(
      "单点标记：精彩内容",
    ),
  );
  check(
    "paused tracking still allows an explicit point marker",
    savedMarker?.cid === "456" &&
      savedMarker.part === 2 &&
      savedMarker.note === "单点标记：精彩内容",
  );
  check(
    "manual marker does not resume tracking or change sessions",
    JSON.stringify(await snapshot(worker)) === JSON.stringify(stopped) &&
      (await worker.evaluate(() => chrome.storage.local.get("biliKeepTrackingEnabled")))
        .biliKeepTrackingEnabled === false,
  );
  const untrackedPlayer = await context.newPage();
  await untrackedPlayer.goto("https://www.bilibili.com/video/BV1xx411c7mE/");
  await untrackedPlayer.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
  await untrackedPlayer.bringToFront();
  await popup
    .getByRole("button", { name: "重新取当前时间", exact: true })
    .evaluate((button) => button.click());
  await eventually(
    async () =>
      !(await popup.getByRole("button", { name: "保存当前时间点", exact: true }).isDisabled()),
    "new CID time point fixed",
  );
  await popup
    .getByRole("textbox", { name: "时间点说明", exact: true })
    .fill("没有观看会话也要回找");
  await untrackedPlayer.bringToFront();
  await popup
    .getByRole("button", { name: "保存当前时间点", exact: true })
    .evaluate((button) => button.click());
  await eventually(
    async () => (await markerData(worker)).markers.length === 2,
    "untracked marker saved",
  );
  check(
    "marker-only video creates no synthetic playback session",
    !(await snapshot(worker)).sessions.some((session) => session.bvid === "BV1xx411c7mE"),
  );
  await untrackedPlayer.close();
  await popup.close();
  await player.close();

  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/my-history.html`);
  await page.getByRole("heading", { name: "Bili Keep · 喜好归档" }).waitFor();
  const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  check(
    "displayed version matches the extension build",
    await page.getByText(`v${version}`, { exact: true }).isVisible(),
  );
  check(
    "library defaults to all recorded videos",
    (await page.getByRole("combobox", { name: "筛选状态" }).inputValue()) === "all",
  );
  const observedBackup = {
    format: "bili-keep",
    version: 1,
    sessions: [
      {
        ...stopped.sessions[0],
        sessionId: "fixture-observed",
        bvid: "BV1xx411c7mE",
        cid: "999",
        title: "【模拟验收】低分观察视频",
        partTitle: "低分分P",
        position: 1,
        foregroundSeconds: 1,
        backgroundSeconds: 0,
        pipSeconds: 0,
        intervals: [[0, 1]],
        interactions: { liked: false, coins: 0, favorited: false, observedAt: Date.now() },
      },
    ],
    decisions: [],
  };
  await page.getByLabel("选择喜好归档备份").setInputFiles({
    name: "observed-fixture.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(observedBackup)),
  });
  await page
    .getByRole("button", { name: "查看详情：【模拟验收】低分观察视频", exact: true })
    .waitFor();
  check(
    "default view includes a low-score observed video",
    (await page.locator('article[aria-label^="视频条目 "]').count()) === 2,
  );
  await page.getByRole("combobox", { name: "筛选状态" }).selectOption("observed");
  await page
    .getByRole("button", { name: "查看详情：【模拟验收】低分观察视频", exact: true })
    .waitFor();
  check(
    "observed filter shows unretained viewing records",
    (await page.locator('article[aria-label^="视频条目 "]').count()) === 1,
  );
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  const search = page.getByRole("textbox", { name: "搜索资料库" });
  await search.fill("参数化 模拟UP 同长第二P");
  await page.locator('article[aria-label^="视频条目 "]').waitFor();
  check(
    "search combines terms across title, author and part titles",
    (await page.locator('article[aria-label^="视频条目 "]').count()) === 1,
  );
  await search.fill("https://www.bilibili.com/video/BV1xx411c7mD/?p=2&t=10");
  await page.locator('article[aria-label^="视频条目 "]').waitFor();
  check(
    "search accepts a Bilibili video URL",
    (await page.locator('article[aria-label^="视频条目 "]').count()) === 1,
  );
  await page.getByRole("combobox", { name: "排序", exact: true }).selectOption("title");
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  check(
    "clear filters restores query, status and sort",
    (await search.inputValue()) === "" &&
      (await page.getByRole("combobox", { name: "筛选状态" }).inputValue()) === "all" &&
      (await page.getByRole("combobox", { name: "排序", exact: true }).inputValue()) === "recent",
  );
  await page.getByRole("combobox", { name: "筛选状态" }).selectOption("interesting");
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
  const resumeLink = page.getByRole("link", { name: /继续观看/ });
  const resumeUrl = new URL(await resumeLink.getAttribute("href"));
  check(
    "resume link exposes the latest part and position",
    (await resumeLink.innerText()).includes("P2") &&
      resumeUrl.searchParams.get("p") === "2" &&
      Number(resumeUrl.searchParams.get("t")) >= 1,
  );
  check(
    "open video link has no resume parameters",
    (await page.getByRole("link", { name: "打开视频 ↗", exact: true }).getAttribute("href")) ===
      "https://www.bilibili.com/video/BV1xx411c7mD/",
  );
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
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.keyboard.press("Escape");
  check(
    "canceling close preserves the open detail and unsaved note",
    (await page.getByRole("dialog").isVisible()) &&
      (await page.getByRole("textbox", { name: "我的备注" }).inputValue()) === "尚未保存的备注",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
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
  check(
    "reopening detail restores the unsaved note draft",
    (await page.getByRole("textbox", { name: "我的备注" }).inputValue()) === "尚未保存的备注",
  );
  await page.getByRole("textbox", { name: "我的备注" }).fill("仅模拟验收数据：回找建模教程");
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await eventually(
    async () => (await snapshot(worker)).decisions[0]?.note.includes("回找建模教程"),
    "note persistence",
  );
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索资料库" }).fill("回找建模教程");
  check(
    "library searches saved notes",
    (await page.locator('article[aria-label^="视频条目 "]').count()) === 1,
  );
  await page.getByRole("combobox", { name: "筛选状态" }).selectOption("noted");
  await page.locator('article[aria-label^="视频条目 "]').waitFor();
  check(
    "noted filter finds a saved personal note",
    (await page.locator('article[aria-label^="视频条目 "]').count()) === 1,
  );
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
  await page.locator('article[aria-label^="视频条目 "]').waitFor();
  await page.getByRole("button", { name: "查看详情", exact: true }).click();
  const tagEditor = page
    .getByRole("dialog")
    .getByRole("textbox", { name: "编辑标签 BV1xx411c7mD", exact: true });
  await tagEditor.fill("尚未保存标签");
  await page.waitForTimeout(5200);
  check(
    "automatic refresh preserves an unsaved tag draft",
    (await tagEditor.inputValue()) === "尚未保存标签",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.getByRole("button", { name: "查看详情", exact: true }).click();
  check(
    "closing and reopening detail restores its tag draft",
    (await tagEditor.inputValue()) === "尚未保存标签",
  );
  await tagEditor.fill("课程, CMOS, 复习, 器件");
  await page.getByRole("dialog").getByRole("button", { name: "保存标签", exact: true }).click();
  await eventually(
    async () => (await markerData(worker)).tags.some((record) => record.tags.includes("CMOS")),
    "video tags persisted",
  );
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  const taggedCard = page.getByRole("article", { name: "视频条目 BV1xx411c7mD", exact: true });
  const cardTag = taggedCard.getByRole("button", { name: "按标签筛选：CMOS", exact: true });
  await cardTag.waitFor({ timeout: 5000 });
  check(
    "card limits visible tag buttons and exposes the remaining label",
    (await taggedCard
      .getByRole("group", { name: "标签快捷筛选", exact: true })
      .getByRole("button")
      .count()) === 3 &&
      (await taggedCard.locator('[title="器件"]').getAttribute("aria-label")) ===
        "另有1个标签：器件",
  );
  const remainingTags = taggedCard.locator('[title="器件"]');
  await remainingTags.focus();
  check(
    "remaining tag names are visible on keyboard focus",
    await remainingTags.locator('span[aria-hidden="true"]').isVisible(),
  );
  await page.getByRole("textbox", { name: "搜索资料库", exact: true }).fill("参数化");
  await cardTag.focus();
  await page.keyboard.press("Enter");
  check(
    "card tag selects the shared tag filter",
    (await page.getByRole("combobox", { name: "筛选标签", exact: true }).inputValue()) === "CMOS" &&
      (await cardTag.getAttribute("aria-pressed")) === "true",
  );
  check(
    "tag click preserves the keyword and current view",
    (await page.getByRole("textbox", { name: "搜索资料库", exact: true }).inputValue()) ===
      "参数化" &&
      (await page.getByRole("combobox", { name: "筛选状态", exact: true }).inputValue()) === "all",
  );
  const markerTag = page
    .getByRole("region", { name: "时间标记", exact: true })
    .getByRole("button", { name: "按标签筛选：CMOS", exact: true });
  check(
    "marker card shares the selected tag state",
    (await markerTag.getAttribute("aria-pressed")) === "true",
  );
  await markerTag.click();
  check(
    "clicking the selected tag clears only the tag filter",
    (await page.getByRole("combobox", { name: "筛选标签", exact: true }).inputValue()) === "" &&
      (await page.getByRole("textbox", { name: "搜索资料库", exact: true }).inputValue()) ===
        "参数化",
  );
  await page.getByRole("combobox", { name: "筛选标签", exact: true }).selectOption("CMOS");
  await page.getByRole("textbox", { name: "搜索资料库", exact: true }).fill("CMOS");
  check(
    "tag names are searchable and filter video cards",
    (await page.locator('article[aria-label^="视频条目 "]').count()) === 1,
  );
  const markerRegion = page.getByRole("region", { name: "时间标记", exact: true });
  const markerRow = markerRegion.getByRole("article").filter({
    has: page.getByRole("textbox", { name: `时间点说明 ${savedMarker.markerId}`, exact: true }),
  });
  await markerRow.waitFor();
  check(
    "marker list follows the video tag filter",
    (await markerRegion.getByRole("article").count()) === 1,
  );
  const markerNoteInput = markerRow.getByRole("textbox", {
    name: `时间点说明 ${savedMarker.markerId}`,
    exact: true,
  });
  await markerNoteInput.fill("尚未保存的筛选草稿");
  await page.getByRole("textbox", { name: "搜索资料库", exact: true }).fill("不匹配的临时条件");
  await markerRow.waitFor({ state: "hidden" });
  await page.getByRole("textbox", { name: "搜索资料库", exact: true }).fill("CMOS");
  await markerRow.waitFor();
  check(
    "filter round trip preserves an unsaved marker note",
    (await markerNoteInput.inputValue()) === "尚未保存的筛选草稿",
  );
  await markerRow
    .getByRole("textbox", { name: `时间点说明 ${savedMarker.markerId}`, exact: true })
    .fill("CMOS 复习重点");
  await markerRow.getByRole("button", { name: "保存说明", exact: true }).click();
  await eventually(
    async () =>
      (await markerData(worker)).markers.find((marker) => marker.markerId === savedMarker.markerId)
        ?.note === "CMOS 复习重点",
    "marker note saved",
  );
  check(
    "marker notes edit independently of the video decision",
    (await snapshot(worker)).decisions[0].note.includes("回找建模教程"),
  );
  const markdownEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出当前标记 Markdown", exact: true }).click();
  const markdownDownload = await markdownEvent;
  const markdownPath = path.join(reports, "markers.md");
  await markdownDownload.saveAs(markdownPath);
  const markdown = await readFile(markdownPath, "utf8");
  check(
    "Markdown export preserves the marker source, note and link",
    markdown.includes("CID 456") &&
      markdown.includes("CMOS 复习重点") &&
      markdown.includes("?p=2&t="),
  );
  await worker.evaluate(() => {
    globalThis.markerFixtureMode = "reordered";
  });
  const reopenedEvent = context.waitForEvent("page");
  await markerRow.getByRole("button", { name: "回到时间点 ↗", exact: true }).click();
  const reopened = await reopenedEvent;
  await reopened.waitForURL(/bilibili\.com\/video\//);
  const reopenedUrl = new URL(reopened.url());
  check(
    "marker jump resolves CID after parts are reordered",
    reopenedUrl.searchParams.get("p") === "1" &&
      Number(reopenedUrl.searchParams.get("t")) === Math.floor(savedMarker.position),
  );
  await reopened.close();
  await page.bringToFront();
  for (const mode of ["missing", "shortened"]) {
    await worker.evaluate((value) => {
      globalThis.markerFixtureMode = value;
    }, mode);
    const tabCount = context.pages().length;
    await markerRow.getByRole("button", { name: "回到时间点 ↗", exact: true }).click();
    await markerRow.getByText(/回跳失败/).waitFor();
    check(
      `marker jump refuses ${mode} source without opening a wrong tab`,
      context.pages().length === tabCount,
    );
  }
  await worker.evaluate(() => {
    globalThis.markerFixtureMode = undefined;
  });
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  const extraBeforeDelete = await markerData(worker);
  const staleBackup = {
    format: "bili-keep",
    version: 2,
    exportedAt: Date.now(),
    ...(await snapshot(worker)),
    ...extraBeforeDelete,
  };
  const markerOnly = extraBeforeDelete.markers.find((marker) => marker.bvid === "BV1xx411c7mE");
  const markerOnlyRow = markerRegion.getByRole("article").filter({
    has: page.getByRole("textbox", { name: `时间点说明 ${markerOnly.markerId}`, exact: true }),
  });
  check(
    "untracked video remains visible in the independent marker list",
    await markerOnlyRow.isVisible(),
  );
  page.once("dialog", (dialog) => dialog.accept());
  await markerOnlyRow.getByRole("button", { name: "删除标记", exact: true }).click();
  await eventually(
    async () =>
      (await markerData(worker)).markers.find((marker) => marker.markerId === markerOnly.markerId)
        ?.deletedAt !== undefined,
    "marker soft deletion",
  );
  await page.getByLabel("选择喜好归档备份").setInputFiles({
    name: "stale-v2.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(staleBackup)),
  });
  await page.getByText("备份已合并，原有记录已保留").waitFor();
  check(
    "old v2 import does not resurrect a deleted marker",
    (await markerData(worker)).markers.find((marker) => marker.markerId === markerOnly.markerId)
      ?.deletedAt !== undefined,
  );
  await page.getByRole("combobox", { name: "筛选状态" }).selectOption("keep");
  await page.locator('article[aria-label^="视频条目 "]').waitFor();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出完整备份", exact: true }).click();
  const download = await downloadEvent;
  const backupPath = path.join(reports, "fixture-backup.json");
  await download.saveAs(backupPath);
  const backup = JSON.parse(await readFile(backupPath, "utf8"));
  check(
    "export includes accumulated sessions and manual notes",
    backup.sessions.length === 3 && backup.decisions[0].note.includes("回找"),
  );
  check(
    "full v2 export includes markers, deletion information and tags",
    backup.version === 2 &&
      backup.markers.length === 2 &&
      backup.markers.some((marker) => marker.deletedAt) &&
      backup.tags.some((record) => record.tags.includes("CMOS")),
  );
  await page.getByLabel("选择喜好归档备份").setInputFiles(backupPath);
  await eventually(
    async () => (await page.getByText("备份已合并，原有记录已保留").count()) > 0,
    "restore feedback",
  );
  check("reimport is idempotent", (await snapshot(worker)).sessions.length === 3);
  const legacyEvent = page.waitForEvent("download");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "导出v1兼容备份", exact: true }).click();
  const legacyDownload = await legacyEvent;
  const legacyPath = path.join(reports, "legacy-v1.json");
  await legacyDownload.saveAs(legacyPath);
  const legacy = JSON.parse(await readFile(legacyPath, "utf8"));
  check(
    "explicit legacy export retains v1 data without pretending to include new modules",
    legacy.version === 1 && legacy.sessions.length === 3 && !legacy.markers && !legacy.tags,
  );
  const denied = await page.evaluate(() =>
    chrome.runtime.sendMessage({ action: "capture.save", session: {} }),
  );
  check("background rejects non-video-page capture messages", denied.success === false);
  check("library loads without JS errors", errors.length === 0);
  const aiAvailability = await page.evaluate(async () => {
    const api = globalThis.LanguageModel;
    let availability = null;
    let error = null;
    if (api?.availability) {
      try {
        availability = await api.availability();
      } catch (reason) {
        error = String(reason);
      }
    }
    return {
      apiPresent: Boolean(api),
      availability,
      error,
      providerConfigured: false,
      performedGeneration: false,
      scope: "isolated Edge extension page, no model download or external generation",
    };
  });
  await writeFile(
    path.join(reports, "ai-availability.json"),
    JSON.stringify({ ...aiAvailability, browserVersion: context.browser()?.version() }, null, 2),
  );
  // Transient notifications need not disappear before capturing verified UI state.
  await page.mouse.move(0, 0);
  await page.screenshot({ path: path.join(reports, "library-fixture.png"), fullPage: true });
  await page.getByRole("button", { name: "查看详情", exact: true }).click();
  await page.screenshot({ path: path.join(reports, "library-detail-fixture.png"), fullPage: true });
  await context.close();
  worker = await start();
  check(
    "library survives browser restart",
    (await snapshot(worker)).decisions[0]?.note.includes("回找建模教程"),
  );
  const restoredExtras = await markerData(worker);
  check(
    "marker edits, deletion and tags survive browser restart",
    restoredExtras.markers.find((marker) => marker.markerId === savedMarker.markerId)?.note ===
      "CMOS 复习重点" &&
      restoredExtras.markers.find((marker) => marker.markerId === markerOnly.markerId)
        ?.deletedAt !== undefined &&
      restoredExtras.tags.some((record) => record.tags.includes("CMOS")),
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
