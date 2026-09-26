<div align="center">
  <img src="public/icon/128.png" alt="哔哩哔哩历史记录保存与分析" width="120" />

  <h1>哔哩哔哩历史记录保存与分析</h1>

  <p>
    <b>保存哔哩哔哩历史记录，查看观看进度、视频时长、分区和 UP 主分析</b>
    <br/>
    Chrome / Edge / Firefox 商店扩展，Safari 可免费自行签名安装
  </p>
</div>

---

## 简介

哔哩哔哩网页端能查看的历史记录有限。这个扩展会把历史记录保存到当前浏览器，方便长期查找、按日期筛选、查看记录分析和导出备份。

扩展不会删除或修改你哔哩哔哩账号里的记录。数据默认只保存在当前浏览器；只有主动配置并使用云端同步时，才会上传到你自己的云端地址。

## 功能

- 自动保存新的哔哩哔哩历史记录，也可以重新检查并保存全部历史
- 在当前浏览器中长期保存历史记录
- 按标题、UP 主、BV 号、AV 号、日期和内容类型查找
- 分析普通视频的长度、观看进度、看完比例、常看的分区和 UP 主
- 支持备份文件和表格文件导出：备份文件以后可以恢复，表格文件适合用 Excel、Numbers 或分析工具打开
- 默认只在本机保存；可选配置个人云端同步
- 可随时删除云端副本并清除本机保存的云端同步设置
- 支持 Safari / Chrome / Edge / Firefox 构建

## 使用

1. 登录[哔哩哔哩网页版](https://www.bilibili.com)。
2. 安装并启用扩展。
3. 点击浏览器工具栏中的扩展图标。
4. 点击「保存历史记录」，第一次使用建议勾选「重新保存全部历史」。
5. 点击「打开记录与分析」，查看、搜索、分析和导出数据。

## 安装

| 浏览器  | 获取方式                                                                                           |
| ------- | -------------------------------------------------------------------------------------------------- |
| Chrome  | 已提交 Chrome Web Store，审核完成后开放商店安装                                                    |
| Edge    | 已提交 Microsoft Edge Add-ons，审核完成后开放商店安装                                              |
| Firefox | 已提交 Firefox Add-ons，审核完成后开放商店安装                                                     |
| Safari  | 使用免费 Apple Account 在自己的 Mac 上签名安装，参见 [Safari 免费安装指南](docs/safari-install.md) |

审核期间，开发者可以从 [GitHub Releases](https://github.com/rmqg/bilibili-history-sync/releases/latest) 获取已校验的构建包，或按下面的本地开发方式构建。Chrome、Edge 和 Firefox 的 ZIP 需要通过浏览器开发者模式加载，不能像商店版本一样直接双击安装。不要安装来源不明的第三方打包版本。

## 本地开发

```bash
pnpm install
pnpm dev
```

常用命令：

| 命令                  | 说明                                          |
| --------------------- | --------------------------------------------- |
| `pnpm dev`            | Chrome 开发模式                               |
| `pnpm dev:firefox`    | Firefox 开发模式                              |
| `pnpm compile`        | TypeScript 类型检查                           |
| `pnpm format:check`   | Prettier 校验                                 |
| `pnpm build`          | Chrome 生产构建                               |
| `pnpm build:safari`   | Safari 生产构建                               |
| `pnpm build:firefox`  | Firefox 生产构建                              |
| `pnpm safari:install` | 使用免费 Apple Account 签名并安装 Safari 版本 |

加载本地扩展：Chrome 打开 `chrome://extensions/`，选择「加载已解压的扩展程序」，加载 `.output/chrome-mv3-dev`。

Safari 本机安装：先在 **Xcode > Settings > Apple Accounts** 登录 Apple Account，再运行 `pnpm safari:install`。完整步骤和更新方式见 [Safari 免费安装指南](docs/safari-install.md)。

## 技术栈

- [WXT](https://wxt.dev)
- React 19
- TailwindCSS 3
- TypeScript
- IndexedDB
- `browser.alarms`

## 隐私

历史记录默认仅保存在当前浏览器。可选云端同步只会在用户主动配置自己的 HTTPS 地址并点击同步后运行。完整说明见 [隐私政策](PRIVACY.md)。

## 发布

四浏览器打包、商店文案、隐私字段和提交步骤见 [发布指南](docs/release/publishing-guide.md)。
逐项人工测试见 [发布前人工测试清单](docs/release/manual-test-checklist.md)。

```bash
pnpm release:package
```

设置页提供的 Cloudflare Worker 部署源码位于 [`cloudflare-worker/`](cloudflare-worker/)。

## 来源与二次开发

本项目基于现有 MTI/Bilibili 历史记录扩展项目二次开发。当前仓库能确认的上游项目为 [Bilibili 无限历史记录 / bilibili-history-wxt](https://github.com/mundane799699/bilibili-history-wxt)，许可证为 MIT。

这版主要调整为“哔哩哔哩历史记录保存与分析”：移除与当前定位无关的页面，补充观看分析、云端同步说明、Safari 兼容处理、四浏览器发布包和审核文档。详细署名见 [NOTICE](NOTICE)。

## License

当前组合版本按 GPL-3.0-only 发布，见 [LICENSE](LICENSE)。上游 MIT 代码及此前版本的 MIT 授权文本保留在 [LICENSE-MIT](LICENSE-MIT)，来源与署名见 [NOTICE](NOTICE)。
