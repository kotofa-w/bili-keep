// Reproducible synthetic CPU baseline; no user text or network requests are used.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const reports = path.join(root, "verification", "markers");
await mkdir(reports, { recursive: true });
async function loadPureModule(relative) {
  const source = await readFile(path.join(root, relative), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const { buildLibraryEntries } = await loadPureModule("utils/preference.ts");
const { queryLibraryEntries } = await loadPureModule("utils/libraryQuery.ts");
function fixture(videos, visits) {
  const sessions = [];
  for (let i = 0; i < videos; i++) {
    for (let visit = 0; visit < visits; visit++) {
      const time = 1_700_000_000_000 + i * 1000 + visit * 3_600_000;
      sessions.push({
        sessionId: `${i}-${visit}`,
        bvid: `BV${i.toString(36).padStart(10, "0")}`,
        cid: String(i + 1),
        part: 1,
        title: i % 3 === 0 ? "合成 CMOS 课程" : "合成模型课程",
        partTitle: "合成分P",
        author: `合成UP${i % 20}`,
        cover: "",
        duration: 120,
        startedAt: time,
        lastSeenAt: time + 60000,
        position: 90,
        foregroundSeconds: 60,
        backgroundSeconds: 10,
        pipSeconds: 0,
        intervals: [
          [0, 45],
          [60, 90],
        ],
        interactions: { observedAt: time },
      });
    }
  }
  return { sessions, decisions: [] };
}
function measure(action) {
  action();
  const times = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    action();
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return { medianMs: Number(times[2].toFixed(2)), maxMs: Number(times[4].toFixed(2)), samples: 5 };
}
const scales = [];
for (const videos of [100, 2000, 10000]) {
  const snapshot = fixture(videos, 5);
  const entries = buildLibraryEntries(snapshot);
  assert.equal(entries.length, videos);
  const query = { keyword: "CMOS 合成UP", status: "all", sort: "recent" };
  assert.equal(queryLibraryEntries(entries, query).length, Math.ceil(videos / 3));
  scales.push({
    videos,
    sessions: snapshot.sessions.length,
    aggregate: measure(() => buildLibraryEntries(snapshot)),
    keywordQuery: measure(() => queryLibraryEntries(entries, query)),
  });
}
let privateRegressionSample = null;
try {
  const sample = JSON.parse(
    await readFile(path.join(root, "data/imports/bili-keep-2026-10-28.json"), "utf8"),
  );
  privateRegressionSample = {
    videos: new Set(sample.sessions.map((item) => item.bvid)).size,
    sessions: sample.sessions.length,
    decisions: sample.decisions.length,
    scope: "previously supplied regression sample, not a census of the current daily library",
  };
} catch {
  /* This local sample is optional and is never copied into the report. */
}
const report = {
  generatedAt: new Date().toISOString(),
  runtime: process.version,
  platform: process.platform,
  logicalCpus: os.availableParallelism(),
  synthetic: true,
  scope:
    "Node CPU-only scoring aggregation and query; excludes IndexedDB, rendering, media and daily-browser measurements",
  scales,
  privateRegressionSample,
  decision:
    "Keep current scoring and simple local queries. No measured daily-library bottleneck or reviewed preference dataset justifies a cache, batch system or scoring v2 in this delivery.",
};
await writeFile(path.join(reports, "roi-benchmark.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
