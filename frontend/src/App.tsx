import { useState } from "react";
import Landing from "./Landing";
import DarkPool from "./DarkPool";
import Faucet from "./Faucet";
import TCA from "./TCA";
import ViewingKeysPage from "./ViewingKeysPage";
import { CONFIG } from "./lib/config";

// Routable views. The TCA + viewing-key pages only exist when their FEATURES flag is on,
// so with all flags false App routes exactly as the live demo (landing / app / faucet).
type View = "landing" | "app" | "faucet" | "tca" | "viewingKeys";

export default function App() {
  const [view, setView] = useState<View>("landing");
  if (view === "landing") return <Landing onLaunch={() => setView("app")} />;
  if (view === "faucet") return <Faucet onHome={() => setView("landing")} onApp={() => setView("app")} />;
  if (view === "tca" && CONFIG.FEATURES.tca) return <TCA onHome={() => setView("app")} />;
  if (view === "viewingKeys" && CONFIG.FEATURES.viewingKeys) return <ViewingKeysPage onHome={() => setView("app")} />;
  return (
    <DarkPool
      onHome={() => setView("landing")}
      onFaucet={() => setView("faucet")}
      onTca={() => setView("tca")}
      onViewingKeys={() => setView("viewingKeys")}
    />
  );
}
