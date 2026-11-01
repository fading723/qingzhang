# 🌿 青账

让每一笔花费都有迹可循。

青账是一款本地保存的个人记账应用。记录精确到**年月日、时分**的收支，查看**每日、每周、每月、每年**的汇总，把账户、分类、预算和账单放在一起管理。

清爽的青绿色界面，支持浅色与深色主题。默认简体中文、人民币、单个账本，无需注册即可开始记录。

[下载 Android 安装包](https://github.com/fading723/qingzhang/releases/download/v1.0.0/qingzhang-1.0.0-android-arm64.apk) · [查看 Releases](https://github.com/fading723/qingzhang/releases) · [使用与构建文档](#-项目文档)

## ✨ 功能特点

| 功能 | 说明 |
| --- | --- |
| 快速记账 | 支出、收入、转账、退款；金额键盘、备注、标签，支持复制账单和连续记账 |
| 精确消费时间 | 默认当前时间，可选择年月日与具体时分，支持补记历史账目 |
| 日／周／月／年统计 | 收支、退款、结余、趋势图、分类占比和消费排行，可切换历史周期并查看对应流水 |
| 账户管理 | 现金、银行卡、微信、支付宝、信用卡及自定义账户；期初余额、转账、还款和余额调整 |
| 两级收支分类 | 自定义名称、图标、颜色和排序；停用分类时保留历史记录 |
| 账单查询 | 按天分组，支持编辑、删除及时间、分类、账户、金额、标签、备注组合筛选 |
| 预算计划 | 月总预算与分类预算，展示已用、剩余和超支，达到 80% 与 100% 时提示 |
| 周期账单 | 房租、订阅、工资等按日、周、月、年生成待办，确认后记账，也可跳过 |
| 备份与迁移 | CSV 导入预览和重复检查、流水导出；完整 JSON 备份、恢复前安全副本 |
| 自适应界面 | 浅色、深色、跟随系统；手机底部导航与宽屏侧边栏 |

金额以整数“分”保存，统计统一使用消费发生时间和北京时间，周一为一周的开始。退款抵减退款发生期间的支出；转账、还款和余额调整不计入收入或支出。

## 📥 下载与安装

### Android

下载 [青账 v1.0.0 APK](https://github.com/fading723/qingzhang/releases/download/v1.0.0/qingzhang-1.0.0-android-arm64.apk)，在手机上打开文件并按系统提示安装。

- 适用于 **Android 7.0 及以上的 ARM64 手机**。
- 安装包内含运行资源，日常记账可以离线使用。
- 版本说明和文件校验值见 [Release 页面](https://github.com/fading723/qingzhang/releases/tag/v1.0.0)。

### iOS 与 Web

| 平台 | 使用方式 |
| --- | --- |
| iOS | 从源码构建，需要 Apple 签名；暂未提供 IPA 安装包 |
| Web | 在电脑浏览器中预览，运行方法见下方开发说明 |

## 📝 开始记账

1. 打开“我的 → 我的账户”，设置账户和期初余额。
2. 点击“记一笔”，填写金额、分类、账户与消费时间。
3. 在“账单”中查找或修改记录，在“统计”中查看不同周期的收支。
4. 在“我的”中设置预算和周期账单，到期后确认或跳过。
5. 在“备份与迁移”中导出完整 JSON，换设备时通过该文件恢复账本。

导入流水前，先建立所需账户与分类，再下载应用内模板填写。仓库也提供 [CSV 示例模板](examples/transactions-template.csv)。CSV 用于交换流水，完整迁移请使用 JSON 备份。

## 🔒 数据与隐私

账本保存在本机，无需登录，没有广告、第三方行为统计或账本云同步。原生应用使用 SQLite，网页使用当前浏览器的 IndexedDB；不同设备和浏览器的账本各自独立。

当前本地账本及导出的 JSON／CSV 未做应用层加密，请妥善保管备份文件。卸载或清理应用数据前，先导出完整备份。更多信息见 [隐私与数据说明](docs/PRIVACY.md)。

## 🛠️ 开发与构建

技术栈：**Expo 58 · React Native 0.88 · TypeScript · SQLite**。

使用 Node.js 24.x（24.3 或更高版本），克隆仓库并安装依赖：

```sh
git clone https://github.com/fading723/qingzhang.git
cd qingzhang
npm ci
npm start
```

### 浏览器预览

```sh
npm run web
```

也可以导出网页资源后启动本地预览服务：

```sh
npm run export:web
npm run preview
```

在电脑浏览器打开 [http://127.0.0.1:4173](http://127.0.0.1:4173)。

### 手机构建

- **Android**：Windows 本地工具链、签名和安装包构建步骤见 [安卓构建说明](docs/ANDROID_BUILD.md)。
- **iOS**：在 macOS 配置 Xcode 后运行 `npm run ios`，或使用 EAS 云构建。
- **EAS**：关联自己的 Expo 项目后，运行 `npm run build:android` 或 `npm run build:ios`。构建配置位于 [`eas.json`](eas.json)。

### 测试

```sh
npm run typecheck
npm test
npx expo export --platform all
```

浏览器交互、性能测试及运行环境见 [验证记录](docs/VALIDATION.md)。

## 📚 项目文档

- [Android 构建与签名](docs/ANDROID_BUILD.md)
- [本机存储、导入与恢复](src/data/README.md)
- [隐私与数据说明](docs/PRIVACY.md)
- [测试与验证记录](docs/VALIDATION.md)
- [版本发布记录](https://github.com/fading723/qingzhang/releases)

核心业务位于 `src/domain/`，存储适配位于 `src/data/`，页面与主题位于 `src/screens/` 和 `src/ui/`。应用名称、图标及包标识统一在 [`app.config.ts`](app.config.ts) 中配置。
