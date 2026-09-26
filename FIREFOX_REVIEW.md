# Firefox reviewer build instructions

Extension: 哔哩哔哩历史记录保存与分析

Version: 2.0.1

## Build environment

- Ubuntu 24.04 or macOS 15+
- Node.js 24
- Corepack enabled
- pnpm as declared by the lockfile

No environment variables, private packages, API keys, or network services are required to build the extension. Dependencies are downloaded only from the package manager registry.

## Reproduce the Firefox package

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm compile
pnpm build:firefox
```

The unpacked Firefox extension is generated at:

```text
.output/firefox-mv2/
```

To generate the upload package and matching source archive:

```bash
pnpm zip:firefox
```

Outputs:

```text
.output/bilibili-history-save-analysis-2.0.1-firefox.zip
.output/bilibili-history-save-analysis-2.0.1-sources.zip
```

## Reviewer notes

- This submission is a derivative version of the existing MTI/Bilibili history extension project. The known upstream repository is `https://github.com/mundane799699/bilibili-history-wxt`; attribution is kept in `NOTICE` and the MIT license text is kept in `LICENSE-MIT`. The current combined release is licensed under GPL-3.0-only.
- Source is TypeScript/React and is bundled by WXT/Vite. There is no obfuscated or remotely executed code.
- The extension only contacts `bilibili.com` to read the signed-in user's history.
- Cloud sync is optional, disabled by default, and runs only after the user enters an HTTPS endpoint and explicitly clicks a test or sync button.
- On Firefox, the cloud-sync action requests optional `authenticationInfo` and `browsingActivity` data-collection permissions before transmitting anything.
- A Bilibili account is only needed to exercise history import. The record browser, settings, backup import, and analytics pages can be reviewed without developer-provided credentials.

## Firefox linter notes

`web-ext lint --source-dir .output/firefox-mv2` returns 0 errors and 0 notices. The remaining warnings are two `UNSAFE_VAR_ASSIGNMENT` warnings for `innerHTML` in `chunks/dist-*.js`.

These warnings point into bundled `react-dom` runtime branches:

- creating a script element in React's DOM implementation;
- React's generic `dangerouslySetInnerHTML` property branch.

The project source does not call `innerHTML` or use `dangerouslySetInnerHTML`. Searching `entrypoints/`, `pages/`, `components/`, and `utils/` for `innerHTML` and `dangerouslySetInnerHTML` returns no matches.
