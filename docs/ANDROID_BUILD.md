# Windows 本地构建与 Android 发布签名

工程提供项目内工具链脚本，不需要 Android Studio、全局 Java 或 EAS 账号。首次运行需要网络下载 JDK、Android SDK 和 Gradle 依赖；工具与缓存都保存在 `.tools/`，不会永久修改系统环境变量。

需要先安装 Node.js 24.3 或更高的 24.x 版本（本项目已在 Node.js 24.15.0 验证）。先运行 `npm ci`，然后在项目根目录使用 PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-android.ps1 -AcceptAndroidLicenses
```

`-AcceptAndroidLicenses` 表示接受 Google Android SDK 的许可协议，可先阅读 [Android SDK 许可条款](https://developer.android.com/studio/terms)。脚本从官方源下载工具；JDK、Android CLI 和 Gradle 压缩包核对固定 SHA256，NDK 核对 Android 官方仓库公布的 SHA1，其余 SDK 组件由 SDK Manager 校验。预先下载的 Gradle 镜像文件也只有与官方校验值一致时才会使用。

脚本会临时使用一个空闲盘符处理中文与长路径，完成后释放映射。Expo 58 的两处 autolinking 查找循环漏掉盘符根目录，脚本对已安装依赖施加精确匹配的修正，使其也检查根目录的 `package.json`。此外，本地构建专用的 `scripts/autolinking-build.cjs` 把当前工程下的依赖路径归一到映射盘并使用 CMake 安全的正斜线，避免 React Native codegen 混用真实盘符和映射盘符。App 的 CMake 中间目录设为 `.tools/cxx`，对象路径限制为 200，让 CMake 对过长的 codegen 目录做哈希缩短且保留足够的固定目录前缀空间，不需要修改 Windows 注册表。这些修正在每次 `npm ci` / prebuild 后重新应用，不修改依赖版本或项目业务代码；未设置本地构建环境变量时仍使用 Expo 原始入口。生成的原生目录位于 `android/`，应以 `app.config.ts` 与 Expo config plugin 为配置源，避免在生成目录中长期手工维护配置。

构建输出：

- `artifacts/qingzhang-1.0.0-android-preview.apk`
- `artifacts/qingzhang-1.0.0-android-preview.apk.sha256`
- `artifacts/android-build.log`
- `artifacts/apk-verification.txt`

## 生成 Release 安装包

首次发布时，先完成上面的构建，再初始化本项目的签名身份：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sign-android.ps1 -InitializeKey
```

后续更新复用同一个密钥，先重新构建，再执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -SkipSdkInstall
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sign-android.ps1
```

发布文件：

- `artifacts/qingzhang-1.0.0-android-arm64.apk`
- `artifacts/qingzhang-1.0.0-android-arm64.apk.sha256`
- `artifacts/qingzhang-1.0.0-android-arm64.apk.verification.txt`

签名脚本使用项目专用 RSA 3072 位密钥，通过 Android 官方 `apksigner` 替换构建模板的调试签名。签后校验唯一证书指纹、APK v2 / v3 签名、16 KB 原生库页面对齐、ARM64 架构、Hermes 字节码、release 标记及权限。发布时只上传校验后的 `android-arm64.apk`，不要上传 `android-preview.apk`。

签名身份保存在被 Git 排除的 `.tools/signing/`：`qingzhang-release.keystore` 是私钥容器，`credentials.json` 含随机口令和证书指纹，`qingzhang-release.cer` 是公开证书。脚本将签名目录及私钥、口令文件的 Windows 访问权限限制为当前账户、SYSTEM 和 Administrators；口令仅通过进程环境传给工具，脚本结束后恢复环境。**请将这个目录单独保存在受保护的备份位置，不要上传 GitHub 或与安装包一起分享。** 后续版本需要同一个签名身份才能覆盖升级；密钥丢失时脚本会停止，不会自动换签。

如果手机安装过此前使用调试签名的预览包，请先在 App 中导出完整 JSON 备份，再卸载预览包、安装 Release 并恢复备份。正式签名与调试签名不同，不能直接覆盖安装。

## 构建参数与工具链

默认构建 `arm64-v8a`，覆盖目前主流 64 位安卓手机。若需同时支持 32 位设备：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-android.ps1 -SkipSdkInstall -Architectures 'arm64-v8a,armeabi-v7a'
```

首次下载完成后可使用 `-SkipSdkInstall` 复用工具链；`-PrepareOnly` 仅安装工具，`-SkipPrebuild` 复用已生成的原生目录。更改 App 配置或原生依赖后不要跳过 prebuild。

`-VerifyOnly` 只验证并发布 `android/app/build/outputs/apk/release/app-release.apk` 中已经编译的安装包，跳过 SDK 组件安装、prebuild 和 Gradle 编译；前置的 JDK、Android CLI、Gradle 工具检查仍会运行，工具缺失时可能下载。它不会证明安装包包含之后修改的源码，也不是对现有 `artifacts` 交付文件的只读检查。验证会检查 Android v2 签名、包名、release 标记、Hermes 字节码头、DEX、原生库、图标字体，以及 Manifest 引用的三组备份排除规则。AAPT 会压缩 XML 文件名，因此通过资源表解析真实路径，再逐项验证排除内容；验证全部成功才替换交付文件。

构建脚本生成包含 Hermes JavaScript bundle 的独立 release 构建，启动和记账不依赖 Metro 或开发电脑。`android-preview.apk` 使用模板调试签名；运行签名脚本得到的 `android-arm64.apk` 使用本机保管的项目专用密钥。

安装后需在安卓真机补做：飞行模式记账与重启保留、系统通知权限拒绝、周期提醒、系统文件分享/选择、全量备份与覆盖恢复、深色主题、大字体及键盘遮挡。无设备时只能报告构建与静态检查结果，不能声称通过真机验收。

工具版本固定为 Temurin JDK 17.0.20.1、Android command-line tools 22.0、Android SDK 37.0、build-tools 37.0.0 / 36.0.0、NDK 27.1.12297006、CMake 3.30.5 / 3.22.1、Gradle 9.4.1，与当前 Expo 58 / React Native 0.88 及原生依赖匹配。Android SDK 的平台安装包名是 `platforms;android-37.0`。App 最低支持 Android 7.0（API 24），当前 target SDK 为 36。

## v1.0.0 Release 构建记录

2026-11-01 使用最新源码重新执行 Android prebuild 和 `:app:assembleRelease`，Gradle 构建成功，391 个任务中 363 个执行、28 个复用。安装包包含通知隐私、导出缓存、CSV 转义及权限修复。

最终文件：`qingzhang-1.0.0-android-arm64.apk`，33,092,242 字节（约 31.56 MiB），版本 `1.0.0`（versionCode 1），最低 API 24、目标 API 36，仅 ARM64。

- APK SHA256：`c44fb20478556e62d02435f422006681a781c494712885005669e7e0e41973aa`
- 签名证书 SHA256：`b89d68ad0dd01966063aab6db85db1911a7152a03b2bd365c814401f7486c923`
- 证书：`CN=Qingzhang, OU=Android, O=Qingzhang`，RSA 3072 位，单一项目签名。
- 校验通过：APK v2 / v3 签名、16 KB 对齐、非 debuggable、Hermes 字节码、三组备份排除规则；外部存储读写和悬浮窗权限均不存在。
- 重签前后 1,141 个 ZIP 文件条目的内容逐项相同；扫描未发现私钥文件、运行时数据库、访问令牌或本机用户／工程路径。

原始构建与校验记录位于本地 `artifacts/`，不包含在源码仓库。设备端测试记录见 [验证说明](VALIDATION.md)。

## 首次预览构建记录（历史）

以下哈希和大小对应首次构建。之后的通知、文件缓存、权限与依赖修复需要重新构建才会进入安装包；不应把下述旧包视为最新源码的构建产物。

2026-11-01 在 Windows 本地完成 `:app:assembleRelease`，Gradle 报告 `BUILD SUCCESSFUL`，391 个任务中 250 个执行、141 个复用缓存。交付 APK 为 33,101,178 字节（约 31.57 MiB），仅包含 `arm64-v8a` ABI，包名 `com.qingzhang.app`，版本 `1.0.0`（versionCode 1）。

SHA256：`a65d6324f67d20c7b6c1fd5995e753a2f847ed789e7e1cd1794c1609b82b6254`。

实际静态检查通过：Android APK Signature Scheme v2（最低 API 24，因此无需旧式 JAR/v1 签名），1,896,688 字节的 Hermes 字节码，3 个 DEX 文件，20 个原生库，1 个字体文件，应用名称“青账”，无 `debuggable` 标记。`allowBackup=false`，旧备份、云备份及设备迁移的 XML 均排除 root、file、database、sharedpref、external 下全部数据。

构建后执行 `adb devices -l`，设备列表为空，因此未进行 Android 安装、启动或真机功能验收。iOS 原生编译、发布签名和真机验收也尚未完成。上述记录仅证明当时的预览包通过了构建与静态检查；正式验收仍须补充设备测试。
