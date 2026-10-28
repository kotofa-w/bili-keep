import { BarChart3, Bookmark, HistoryIcon, Moon, SettingsIcon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { THEME_MODE, UPDATE_HISTORY } from "../utils/constants";
import { getStorageValue } from "../utils/storage";
import { setTheme, type ThemeMode } from "../utils/theme";

const navItems = [
  {
    title: "喜好资料库",
    icon: <Bookmark className="w-4 h-4" />,
    to: "/library",
  },
  {
    title: "历史记录",
    icon: <HistoryIcon className="w-4 h-4" />,
    to: "/",
  },
  {
    title: "记录分析",
    icon: <BarChart3 className="w-4 h-4" />,
    to: "/analytics",
  },
  {
    title: "设置",
    icon: <SettingsIcon className="w-4 h-4" />,
    to: "/settings",
  },
];

type SidebarProps = {
  activePath: string;
};

export const Sidebar = ({ activePath }: SidebarProps) => {
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const version = UPDATE_HISTORY[0]?.version || "";

  useEffect(() => {
    getStorageValue<ThemeMode>(THEME_MODE, "light").then((mode) =>
      setThemeMode(mode === "dark" ? "dark" : "light"),
    );

    const handleStorageChange = (
      changes: { [key: string]: Browser.storage.StorageChange },
      areaName: string,
    ) => {
      if (areaName !== "local" || !changes[THEME_MODE]) return;
      const next = changes[THEME_MODE].newValue as ThemeMode | undefined;
      setThemeMode(next === "dark" ? "dark" : "light");
    };

    browser.storage.onChanged.addListener(handleStorageChange);
    return () => browser.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  const isDark = themeMode === "dark";

  return (
    <aside className="fixed top-0 left-0 w-40 bg-gray-100 dark:bg-[#141414] dark:text-neutral-100 flex-shrink-0 h-full">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-4 dark:border-neutral-800">
        <img src="/icon/32.png" alt="" className="h-8 w-8 shrink-0 rounded-lg" />
        <div>
          <p className="text-sm font-semibold leading-5 text-gray-900 dark:text-neutral-100">
            Bili Keep
          </p>
          <p className="text-xs leading-5 text-gray-500 dark:text-neutral-400">喜好归档</p>
        </div>
      </div>

      <nav className="space-y-2 p-4">
        {navItems.map((item) => {
          const isActive = activePath === item.to;
          return (
            <a
              key={item.to}
              href={`#${item.to}`}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-white dark:bg-neutral-800 text-blue-600 dark:text-blue-400 shadow-sm"
                  : "text-gray-700 dark:text-neutral-300 hover:bg-white/80 dark:hover:bg-neutral-800"
              }`}
            >
              {item.icon}
              <span>{item.title}</span>
            </a>
          );
        })}
      </nav>

      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
        <p className="text-gray-600 dark:text-neutral-400 text-base leading-none">
          {version ? `v${version}` : ""}
        </p>
        <button
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          title={isDark ? "切换到浅色模式" : "切换到深色模式"}
          aria-label={isDark ? "切换到浅色模式" : "切换到深色模式"}
          className="inline-flex items-center justify-center w-8 h-8 rounded-md text-gray-600 hover:bg-gray-200 dark:text-neutral-300 dark:hover:bg-neutral-800 transition-colors"
        >
          {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
};
