# 本机存储与可迁移文件

- iOS / Android 使用 `expo-sqlite`，数据库 `qingzhang.db`，WAL、外键开关、版本化迁移及独占事务已启用。实体按 ID 差量更新，不逐次重写所有流水。任何校验或事务失败都不发布新状态。
- 网页预览由 Metro 自动选择 `repository.web.ts`，使用浏览器 IndexedDB；未提供内存降级。网页数据与手机数据库不共享，清理站点数据会清除网页账本。双端迁移请使用完整 JSON 备份。
- iOS 独立 App 的 SQLite 与恢复前安全副本位于 `Library/Application Support/Qingzhang`。`plugins/withLocalOnlyBackup.js` 在 Swift AppDelegate 启动时创建目录并设置 `isExcludedFromBackup`；若设置失败则停止启动。Android Manifest 禁用自动备份，并同时配置旧版 backup rules 与 Android 12+ cloud/device extraction rules。
- Expo Go 不应用项目原生配置插件，其沙盒路径、通知及备份策略不能代表最终 App 验收。iOS Expo Go 使用被隔离的 Documents 子目录以满足宿主权限，正式隐私与存储验收必须在独立 App 完成。
- 手动导出是用户主动操作。导出文件是可读的 JSON/CSV，包含财务数据；导出到任何位置后由用户管理。应用不访问服务器，不申请远程推送 token。
- 系统分享面板关闭及浏览器下载触发均不能证明文件已经保存。`exportText` 只保证已交接导出流程；界面须由用户确认保存后才更新最近备份时间，取消选择文件不会改变账本。
- CSV 上限为 25 MB / 十万行；完整备份上限为 100 MB，导出和恢复使用相同限制。版本 1 采用封闭字段结构，拒绝未知字段、无效引用和金额溢出；CSV 导出的创建/更新时间规范化为 UTC，导入允许带时区的合法 ISO 时间。
- CSV 表头和标签JSON不可删除；账户/分类优先按 ID 匹配，其次按唯一名称匹配。新的账户/分类请先在 App 创建。退款原支出必须存在于账本或同一导入文件；CSV 不含预算、周期规则或完整关联，不替代完整备份。
- CSV 文本使用 RFC 4180 引号规则、UTF-8 BOM，并对公式起始字符做可逆转义，方便中文电子表格查看。历史相似记录仅提示；重复 ID 阻止整批导入。
- 覆盖恢复前，调用 `saveSafetyBackup`，成功后才原子替换账本；`readSafetyBackup` 提供最近一份安全副本。设备端安全副本保存在排除云备份的私有目录，网页保存在单独的 IndexedDB。
- SQLite 读取同时检查修订号、行主键和 JSON 内部 ID。缺失设置但任何实体表仍有数据时拒绝初始化，避免把损坏账本误当空账本覆盖。
- 本机通知最多调度接下来的 30 期，在应用回到前台和规则变动时补充。长时间不打开 App 时，已调度范围以外的提醒无法送达；待确认账单始终按规则计算，不会因通知遗漏而丢失。

官方依据：
- [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [Expo FileSystem](https://docs.expo.dev/versions/latest/sdk/filesystem/)
- [Expo Notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [Android 自动备份](https://developer.android.com/identity/data/autobackup)
- [Apple isExcludedFromBackup](https://developer.apple.com/documentation/foundation/urlresourcevalues/isexcludedfrombackup)
