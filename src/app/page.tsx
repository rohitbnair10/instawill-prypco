"use client";

import { useState } from "react";
import { ClientJourney } from "@/components/client/ClientJourney";
import { LawyerDesk } from "@/components/lawyer/LawyerDesk";
import { OpsDesk } from "@/components/ops/OpsDesk";
import { resetStore } from "@/lib/store";

type Surface = "client" | "lawyer" | "ops";

const TABS: Array<{ key: Surface; label: string; sub: string }> = [
  { key: "client", label: "Client journey", sub: "7-step intake" },
  { key: "lawyer", label: "Lawyer review", sub: "audit & approve" },
  { key: "ops", label: "Re-engagement", sub: "recover intakes" },
];

export default function Home() {
  const [surface, setSurface] = useState<Surface>("client");
  // Force a fresh ClientJourney intake each time the tab is (re)entered.
  const [clientKey, setClientKey] = useState(0);

  return (
    <div className="min-h-screen bg-paper">
      {/* top toggle */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-hairline bg-paper-parchment/95 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="font-serif text-lg font-semibold text-ink">
            Insta<span className="text-sage">Will</span>
          </span>
          <span className="hidden text-xs text-slate sm:inline">
            DIFC non-Muslim wills — assisted drafting
          </span>
        </div>

        <nav className="flex items-center gap-1 rounded-full bg-paper-deep p-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                if (t.key === "client" && surface !== "client")
                  setClientKey((k) => k + 1);
                setSurface(t.key);
              }}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                surface === t.key
                  ? "bg-ink text-paper-parchment"
                  : "text-slate hover:text-ink"
              }`}
              title={t.sub}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <button
          onClick={() => {
            if (confirm("Reset all demo data?")) {
              resetStore();
              setClientKey((k) => k + 1);
            }
          }}
          className="hidden text-xs text-slate underline hover:text-ink sm:inline"
        >
          Reset demo
        </button>
      </header>

      <main>
        {surface === "client" && <ClientJourney key={clientKey} />}
        {surface === "lawyer" && <LawyerDesk />}
        {surface === "ops" && <OpsDesk />}
      </main>
    </div>
  );
}
