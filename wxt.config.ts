import { defineConfig } from "wxt";

const escapeNonAscii = (value: string) =>
  value.replace(/[^\x00-\x7F]/g, (char) => {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) return char;
    if (codePoint <= 0xffff) return `\\u${codePoint.toString(16).padStart(4, "0")}`;
    return `\\u{${codePoint.toString(16)}}`;
  });

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [
      {
        name: "escape-non-ascii-js",
        generateBundle(_options, bundle) {
          for (const output of Object.values(bundle)) {
            if (output.type === "chunk") {
              output.code = escapeNonAscii(output.code);
            }
          }
        },
      },
    ],
  }),
  manifest: ({ browser }) => ({
    name: "Bili Keep · B站喜好归档",
    short_name: "Bili Keep",
    description: "自动记录B站观看投入、整理可能喜欢的视频，支持本地搜索、保留、备注和备份。",
    homepage_url: "https://github.com/kotofa-w/bili-keep",
    permissions: ["storage", "cookies", "alarms"],
    host_permissions: ["*://bilibili.com/*", "*://*.bilibili.com/*"],
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "bili-keep@kotofa-w.github.io",
              strict_min_version: "140.0",
              data_collection_permissions: {
                required: ["none"],
                optional: ["authenticationInfo", "browsingActivity"],
              },
            },
            gecko_android: {
              strict_min_version: "142.0",
            },
          },
        }
      : {}),
  }),
  zip: {
    artifactTemplate: "{{name}}-{{version}}-{{browser}}.zip",
    sourcesTemplate: "{{name}}-{{version}}-sources.zip",
    includeSources: [
      ".editorconfig",
      ".gitignore",
      ".prettierignore",
      ".prettierrc",
      "utils/**/*.test.ts",
    ],
    excludeSources: [
      "data/**",
      "outputs/**",
      "verification/**",
      "work/**",
      "logs/**",
      "**/.cache/**",
      "**/.git/**",
      "**/.vscode/**",
      "**/.mcp.json",
      "**/.env",
      "**/.env.*",
      "**/*.log",
      "**/AGENTS.md",
      "**/CLAUDE.md",
      "01_PROJECT.md",
      "02_STATUS.md",
      "03_HISTORY.md",
      "04_FILE_INDEX.md",
      "docs/initial-plan.md",
    ],
  },
});
