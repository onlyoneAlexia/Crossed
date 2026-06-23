import { useState } from "react";
import Landing from "./Landing";
import DarkPool from "./DarkPool";
import Faucet from "./Faucet";

export default function App() {
  const [view, setView] = useState<"landing" | "app" | "faucet">("landing");
  if (view === "landing") return <Landing onLaunch={() => setView("app")} />;
  if (view === "faucet") return <Faucet onHome={() => setView("landing")} onApp={() => setView("app")} />;
  return <DarkPool onHome={() => setView("landing")} onFaucet={() => setView("faucet")} />;
}
