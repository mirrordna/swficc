"use client";

import { useState } from "react";
import type { AlertItem, SavedView } from "@/lib/types";

interface ActionPanelProps {
  alerts?: AlertItem[];
  savedViews?: SavedView[];
}

export default function ActionPanel({ alerts = [], savedViews = [] }: ActionPanelProps) {
  const [alertStates, setAlertStates] = useState<Record<string, boolean>>(() => {
    const stored: Record<string, boolean> = {};
    alerts.forEach((a) => { stored[a.label] = true; });
    return stored;
  });

  const toggleAlert = (label: string) => {
    setAlertStates((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  return (
    <aside className="flex flex-col gap-0 py-4 bg-white border-l border-gray-200 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto w-[240px] min-w-[240px]">
      {/* Saved */}
      <Section icon="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" title="Saved">
        {savedViews.length > 0 ? (
          savedViews.map((v) => (
            <a key={v.label} href={v.href} className="block px-2.5 py-2 text-sm border border-gray-100 rounded-md hover:bg-gray-50 hover:border-gray-300 no-underline text-gray-800 transition-colors">
              <strong className="block text-[0.82rem] text-gray-800 mb-0.5">{v.label}</strong>
              <p className="m-0 text-[0.74rem] text-gray-500">{v.query}</p>
            </a>
          ))
        ) : (
          <p className="m-0 py-2.5 text-center text-[0.78rem] text-gray-400 bg-gray-50 rounded-md">No saved views yet.</p>
        )}
      </Section>

      {/* Alerts */}
      <Section icon="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" title="Alerts">
        {alerts.map((a) => {
          const isActive = alertStates[a.label] !== false;
          return (
            <button
              key={a.label}
              onClick={() => toggleAlert(a.label)}
              className={`block w-full text-left px-2.5 py-2 text-sm border rounded-md cursor-pointer transition-colors ${
                isActive
                  ? "border-red-600 bg-red-600/5 text-red-800"
                  : "border-gray-200 bg-white text-gray-700"
              }`}
            >
              {a.label} &middot; {isActive ? "on" : "off"}
            </button>
          );
        })}
      </Section>

      {/* Recent */}
      <Section icon="M12 12a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2" title="Recent">
        <p className="m-0 py-2.5 text-center text-[0.78rem] text-gray-400 bg-gray-50 rounded-md">
          Recently viewed items appear here.
        </p>
      </Section>

      {/* Viewed */}
      <Section icon="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" title="Viewed">
        <p className="m-0 py-2.5 text-center text-[0.78rem] text-gray-400 bg-gray-50 rounded-md">
          Your view history will appear here.
        </p>
      </Section>
    </aside>
  );
}

function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <section className="px-4 py-3 border-b border-gray-100 last:border-b-0">
      <h4 className="flex items-center gap-2 m-0 mb-2.5 text-[0.78rem] font-bold text-gray-700">
        <svg className="w-4 h-4 opacity-60 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path d={icon} />
        </svg>
        {title}
      </h4>
      <div className="grid gap-1.5">
        {children}
      </div>
    </section>
  );
}
