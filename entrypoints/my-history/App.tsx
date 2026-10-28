import { useEffect, useState } from "react";
import { History } from "../../pages/History";
import { Sidebar } from "../../components/Sidebar";
import Settings from "../../pages/Settings";
import ScrollToTopButton from "../../components/ScrollToTopButton";
import { Toaster } from "react-hot-toast";
import Analytics from "../../pages/Analytics";
import Library from "../../pages/Library";

const routes = new Set(["/", "/library", "/analytics", "/settings"]);

const getCurrentPath = () => {
  const path = window.location.hash.replace(/^#/, "") || "/library";
  return routes.has(path) ? path : "/library";
};

const App = () => {
  const [currentPath, setCurrentPath] = useState(getCurrentPath);

  useEffect(() => {
    const handleHashChange = () => {
      const path = getCurrentPath();
      setCurrentPath(path);
      if (!routes.has(window.location.hash.replace(/^#/, "") || "/library")) {
        window.history.replaceState(null, "", "#/library");
      }
    };

    handleHashChange();
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const page =
    currentPath === "/library" ? (
      <Library />
    ) : currentPath === "/analytics" ? (
      <Analytics />
    ) : currentPath === "/settings" ? (
      <Settings />
    ) : (
      <History />
    );

  return (
    <>
      <Toaster position="top-center" />
      <div className="flex min-h-screen dark:bg-[#0a0a0a] dark:text-neutral-100">
        <Sidebar activePath={currentPath} />
        <main className="ml-40 w-full transition-all duration-300">{page}</main>
        <ScrollToTopButton />
      </div>
    </>
  );
};

export default App;
