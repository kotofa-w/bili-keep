# 四浏览器发布指南

版本：2.0.1

## 1. 发布前检查

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm release:package
```

该命令会依次检查格式和类型、构建四个浏览器、生成五个 ZIP、写入
`.output/SHA256SUMS.txt`，再检查 manifest、隐私清单、Safari 中文编码和发布文档。

需要单独复核下载或复制后的文件时，在仓库根目录运行：

```bash
(cd .output && shasum -a 256 -c SHA256SUMS.txt)
```

发布前必须确认：

- `package.json` 与 `utils/constants.ts` 版本一致；
- `LICENSE`、`LICENSE-MIT` 与 `NOTICE` 已随扩展包一起打包，二次开发来源说明没有被删掉；
- 隐私政策公网地址可以在未登录状态下打开；
- 商店截图来自当前版本，且没有真实账号、同步密钥或私人历史；
- 四个浏览器至少各完成一次安装、保存历史、筛选、分析、导入导出测试；
- 云端同步至少完成一次首次上传和第二台浏览器合并测试。

## 2. 构建产物

运行 `pnpm package:stores` 后：

| 商店                          | 上传文件                                                   |
| ----------------------------- | ---------------------------------------------------------- |
| Chrome Web Store              | `.output/bilibili-history-save-analysis-2.0.1-chrome.zip`  |
| Microsoft Edge Add-ons        | `.output/bilibili-history-save-analysis-2.0.1-edge.zip`    |
| Firefox Add-ons               | `.output/bilibili-history-save-analysis-2.0.1-firefox.zip` |
| Firefox 源代码                | `.output/bilibili-history-save-analysis-2.0.1-sources.zip` |
| Safari Web Extension Packager | `.output/bilibili-history-save-analysis-2.0.1-safari.zip`  |

不要把 Firefox 源代码包当作扩展包上传。不要上传 `.output/*-mv*` 文件夹外层目录，商店要求 `manifest.json` 位于压缩包根目录。

## 3. Chrome Web Store

1. 在 Chrome Web Store Developer Dashboard 创建新项目或打开现有项目。
2. 上传 Chrome ZIP。
3. 商店主要语言选择简体中文，粘贴 `store-listing-zh-CN.md` 中的文案。
4. 上传 128×128 图标、至少一张 1280×800 截图和 440×280 小型宣传图。
5. 在 Privacy practices 中填写单一用途和每项权限说明。
6. Remote code 选择“否”。本扩展只请求 JSON 数据，不执行远程代码。
7. 按文档填写数据使用声明，并填写公网隐私政策 URL。
8. 可见性建议先选 Unlisted 完成审核测试，确认无误后再改为 Public。

Privacy practices 建议按保守口径填写：

- 单一用途：粘贴 `store-listing-zh-CN.md` 中的“单一用途”；
- 数据类型：选择 Web history；云同步会发送用户自设的同步密钥时，同时选择 Authentication information；
- 数据使用：只选 App/extension functionality；
- 勾选数据不会出售、不会用于与单一用途无关的目的、不会用于信用评估或借贷；
- 远程代码选择 No；
- 隐私政策填写 `https://blog.rmqg.org/bilibili-history-sync/privacy-policy/`。

如果后台字段名称与上面不同，以后台当前选项为准，但不要把“默认只存在本机”误填成“不处理浏览历史”：扩展确实会读取和保存哔哩哔哩历史，保守披露更准确。

## 4. Microsoft Edge Add-ons

1. 在 Partner Center 的 Edge extensions 区域创建或打开扩展。
2. 在 Packages 上传 Edge ZIP。
3. 在 Store listings 填写详细描述。Edge 要求详细描述至少 250 个字符。
4. 上传正方形扩展 logo；推荐 300×300，最低可以使用仓库中的 128×128 图标。
5. 建议复用 1280×800 商店截图。440×280 和 1400×560 宣传图在 Edge 为可选。
6. Properties 中个人信息选择 Yes；隐私政策使用 Edge 专用地址
   `https://blog.rmqg.org/bilibili-history-sync/privacy-policy/edge/`。
7. Website URL 填 `https://blog.rmqg.org/bilibili-history-sync/`，Support contact details 填
   `https://blog.rmqg.org/bilibili-history-sync/support/`。
8. 可见性第一次建议选 Hidden，市场按实际支持范围选择，确认安装和更新正常后再改 Public。
9. 填写年龄分级并提交认证。

## 5. Firefox Add-ons

本项目作为独立扩展发布，不复用 MTI 上游项目的 AMO 条目。manifest 中的固定 ID 为：

```text
bilibili-history-sync@rmqg.org
```

1. 在 AMO 创建新的公开附加组件并上传 Firefox ZIP。首次提交后，后续版本必须继续使用上述固定 ID。
2. 同时上传 sources ZIP，构建说明见仓库根目录 `FIREFOX_REVIEW.md`。
3. 数据收集声明应显示“默认不收集”，并列出可选 `browsingActivity` 与 `authenticationInfo`。
4. 详细描述必须说明云端同步默认关闭、数据只发送到用户指定地址。
5. 上传当前版本截图、隐私政策 URL、支持 URL、GPL-3.0-only 许可证及上游 MIT 来源说明和 2.0.1 更新说明。
6. Firefox 桌面最低版本为 140；Firefox Android 最低版本为 142，以使用浏览器内置的数据传输授权。

AMO 的 source code 问题选择 Yes。扩展 ZIP 上传 Firefox 包，Source code 单独上传 sources 包；Reviewer notes 可直接粘贴 `FIREFOX_REVIEW.md` 的 Reviewer notes。不要上传 Chrome、Edge 或 Safari 包。

## 6. Safari / Mac App Store

### 免费方案：仅供本人使用

不购买 Apple Developer Program 时，可以使用免费 Apple Account 的 Personal Team 在自己的 Mac 上签名安装：

```bash
corepack pnpm safari:install
```

面向普通用户的完整步骤见 [`docs/safari-install.md`](../safari-install.md)。该方式不能上传 Mac App Store，也不适合把签名后的应用直接分发给其他人。

### 方案 A：本机 Xcode 项目

```bash
SAFARI_BUNDLE_ID=com.yourname.bilibili-history-save-analysis \
SAFARI_BUILD_NUMBER=1 \
corepack pnpm package:safari
```

然后：

1. 打开 `.output/safari-xcode` 中生成的 Xcode 项目。
2. 为宿主 App 和 Extension target 选择 Apple Developer Team。
3. 把 Bundle ID 改为开发者账号中已注册且唯一的 ID；Extension ID 保持宿主 ID 的子标识。
4. 脚本默认写入当前版本、构建号 `1` 和最低 macOS 13.0。每次重新上传都要增大
   `SAFARI_BUILD_NUMBER`；如需改变最低版本，可设置 `SAFARI_DEPLOYMENT_TARGET`。
5. 在真机 Safari 中测试宿主 App、扩展启用、Cookie 权限、历史保存和全部页面。
6. 选择 Product > Archive，然后在 Organizer 中选择 Distribute App > App Store Connect。
7. 在 App Store Connect 填写 macOS 产品页、隐私政策、App Privacy、截图、支持 URL 和审核说明。

App Privacy 建议按仓库中的 `public/PrivacyInfo.xcprivacy` 一致填写：可选收集 Browsing History 和 Device ID，只用于 App Functionality，不与用户身份关联，不用于 Tracking。默认本地保存本身不产生离机收集，但云端同步可能把这两类数据发送到用户指定的服务，因此采用保守披露。

### 方案 B：App Store Connect Safari Web Extension Packager

也可以在 App Store Connect 创建 macOS App 记录后，使用 Safari Web Extension Packager 上传 Safari ZIP。打包完成后先通过 TestFlight 测试，再提交 App Store 审核。

Safari 正式分发必须加入 Apple Developer Program并完成代码签名；临时未签名扩展不能直接上传 App Store。

## 7. 隐私政策上线

仓库已经提供 `docs/privacy-policy/index.html`。使用 GitHub Pages 时：

1. 打开 GitHub 仓库 Settings > Pages。
2. Source 选择 Deploy from a branch。
3. Branch 选择 `main`，目录选择 `/docs`。
4. 保存并等待部署。
5. 在无痕窗口确认以下地址可访问：

```text
https://blog.rmqg.org/bilibili-history-sync/privacy-policy/
https://blog.rmqg.org/bilibili-history-sync/privacy-policy/edge/
https://blog.rmqg.org/bilibili-history-sync/support/
```

只有该地址实际公开后，才能把它填写到商店表单。

## 8. 建议的实际提交顺序

1. 先把当前改动提交并推送到 GitHub，等待 GitHub Pages 三个地址公开。
2. 按 `manual-test-checklist.md` 完成四浏览器人工测试并拍三张 1280×800 截图。
3. 先提交 Chrome、Edge 和 Firefox；它们可以直接使用 `.output` 中的 ZIP。
4. Safari 先在 Xcode 真机测试，再决定使用 Xcode Archive 或 App Store Connect Web Extension Packager。
5. 每个平台提交后保存条目 ID、审核状态和商店 URL；通过后再把商店链接补回 README 和项目主页。

## 9. 不能自动完成的账号步骤

- 支付或激活各商店开发者账号；
- 接受商店协议、税务和开发者身份验证；
- 注册 Apple Bundle ID、选择签名 Team、创建 App Store Connect App；
- 在商店后台填写最终联系邮箱和开发者名称；
- 上传真实当前版本截图并最终点击提交审核。

## 10. 商店官方资料

- Chrome：[商品详情要求](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/)、[隐私信息填写](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy/)
- Edge：[发布 Microsoft Edge 扩展](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
- Firefox：[提交源代码](https://extensionworkshop.com/documentation/publish/source-code-submission/)、[内置数据传输授权](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)、[附加组件政策](https://extensionworkshop.com/documentation/publish/add-on-policies/)
- Safari：[分发 Safari Web Extension](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension)、[通过 App Store Connect 打包和分发](https://developer.apple.com/documentation/safariservices/packaging-and-distributing-safari-web-extensions-with-app-store-connect)、[App Privacy 填写说明](https://developer.apple.com/app-store/app-privacy-details/)、[隐私清单](https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk)
