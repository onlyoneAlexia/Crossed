import { useState, useEffect, useCallback } from "react";
import Landing from "./Landing";
import DarkPool from "./DarkPool";
import Faucet from "./Faucet";
import TCA from "./TCA";
import ViewingKeysPage from "./ViewingKeysPage";
import { CONFIG } from "./lib/config";

// Real URL routes (History API — no router dependency). Each view has a path, so pages are
// deep-linkable, refresh-safe, and browser back/forward works. The TCA + viewing-key pages
// only exist when their FEATURES flag is on; with all flags false the routes are landing /
// /app/swaps / /faucet exactly like the live demo.
type View = "landing" | "app" | "faucet" | "tca" | "viewingKeys";

const VIEW_PATH: Record<View, string> = {
  landing: "/",
  app: "/app/swaps",
  faucet: "/app/faucet",
  tca: "/app/execution",
  viewingKeys: "/app/viewing-key",
};

function viewFromPath(path: string): View {
  if (path.startsWith("/app/faucet")) return "faucet";
  if (path.startsWith("/app/execution")) return "tca";
  if (path.startsWith("/app/viewing-key")) return "viewingKeys";
  if (path.startsWith("/app")) return "app";
  return "landing";
}

// Collapse a view onto an allowed one (a flag-gated page that's off falls back to the app).
function resolveView(v: View): View {
  if (v === "tca" && !CONFIG.FEATURES.tca) return "app";
  if (v === "viewingKeys" && !CONFIG.FEATURES.viewingKeys) return "app";
  return v;
}

export default function App() {
  const [view, setView] = useState<View>(() =>
    resolveView(viewFromPath(typeof window !== "undefined" ? window.location.pathname : "/")),
  );

  // Navigate: update the URL (pushState) and the view together.
  const go = useCallback((next: View) => {
    const v = resolveView(next);
    setView(v);
    const path = VIEW_PATH[v];
    if (typeof window !== "undefined" && window.location.pathname !== path) {
      window.history.pushState({ v }, "", path);
    }
  }, []);

  // Keep the view in sync with browser back/forward, and normalize the initial URL so the bar
  // reflects the resolved view (e.g. landing stays "/", a gated-off /execution becomes /app/swaps).
  useEffect(() => {
    const onPop = () => setView(resolveView(viewFromPath(window.location.pathname)));
    window.addEventListener("popstate", onPop);
    const wantPath = VIEW_PATH[resolveView(viewFromPath(window.location.pathname))];
    if (window.location.pathname !== wantPath) {
      window.history.replaceState({}, "", wantPath);
    }
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const content =
    view === "landing" ? <Landing onLaunch={() => go("app")} /> :
    view === "faucet" ? <Faucet onHome={() => go("landing")} onApp={() => go("app")} /> :
    view === "tca" ? <TCA onHome={() => go("app")} /> :
    view === "viewingKeys" ? <ViewingKeysPage onHome={() => go("app")} /> : (
      <DarkPool
        onHome={() => go("landing")}
        onFaucet={() => go("faucet")}
        onTca={() => go("tca")}
        onViewingKeys={() => go("viewingKeys")}
      />
    );

  // key on the view so a navigation remounts the subtree → the routeIn entrance replays,
  // making the move into the app feel like an arrival instead of a hard tree swap.
  return <div className="route-view" key={view}>{content}</div>;
}
