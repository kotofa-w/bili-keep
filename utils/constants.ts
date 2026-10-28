export const IS_SYNCING = "isSyncing";
export const SYNC_LOCK_STARTED_AT = "syncLockStartedAt";
export const HAS_FULL_SYNC = "hasFullSync";
export const LAST_FULL_SYNC = "lastFullSync";

export const SYNC_INTERVAL = "syncInterval";
export const SYNC_TIME_REMAIN = "syncTimeRemain";
export const SYNC_PROGRESS_HISTORY = "syncProgressHistory";
export const CLOUD_SYNC_CONFIG = "cloudSyncConfig";
export const CLOUD_SYNC_DEVICE_ID = "cloudSyncDeviceId";
export const CLOUD_SYNC_LAST_SYNC_AT = "cloudSyncLastSyncAt";

export const DATE_SELECTION_MODE = "date_selection_mode";
export const TIME_ZONE = "timeZone";
export const GRID_COLUMNS = "gridColumns";

export const THEME_MODE = "themeMode";

export const UPDATE_HISTORY = [
  {
    date: "2026-10-28",
    version: "2.2.0",
    changes: [
      "主动保存单点时间标记与简短说明，按CID确认分P后回跳",
      "轻量视频标签与筛选，标记Markdown导出及完整v2备份",
    ],
  },
  {
    date: "2026-10-28",
    version: "2.1.3",
    changes: [
      "资料库默认显示全部记录，支持多关键词、分P标题和视频链接搜索",
      "新增已观察、有备注筛选与标题排序，回看入口显示分P及播放位置",
    ],
  },
  {
    date: "2026-10-28",
    version: "2.1.2",
    changes: ["更新用户提供的图标及公开项目说明，补充上游来源与鸣谢"],
  },
  {
    date: "2026-10-28",
    version: "2.1.1",
    changes: [
      "喜好资料库封面卡片、评分构成环图及悬停数据，点击查看详细依据和备注",
      "兼容B站HTTP封面地址",
    ],
  },
  {
    date: "2026-10-28",
    version: "2.1.0",
    changes: ["Bili Keep初版：有效观看采集、喜好资料库、手动保留和独立本地备份"],
  },
  {
    date: "2026-07-10",
    version: "2.0.1",
    changes: [
      "修复自动保存可能并发运行或卡在保存状态的问题",
      "普通更新改为回看最近 7 天，并每周自动完整校验一次",
      "新增 Safari 免费签名安装脚本和说明",
    ],
  },
  {
    date: "2026-07-10",
    version: "2.0.0",
    changes: ["全新定位为哔哩哔哩历史记录保存与分析工具", "新增观看分析、时区和可选云端同步"],
  },
] as const;
