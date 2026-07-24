"use client";

import { useState } from "react";
import type { AlertItem } from "@/lib/types";

interface ActionPanelProps {
  alerts?: AlertItem[];
}

export default function ActionPanel({ alerts = [] }: ActionPanelProps) {
  const [alertStates, setAlertStates] = useState<Record<string, boolean>>(() => {
    const stored: Record<string, boolean> = {};
    alerts.forEach((a) => { stored[a.label] = true; });
    return stored;
  });

  const toggleAlert = (label: string) => {
    setAlertStates((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  return (
    <aside className="flex flex-col bg-white border-l border-gray-300 min-h-0 w-full min-w-0 md:min-h-[calc(100vh-56px)] md:w-[240px] md:min-w-[240px]">
      <div className="border-b border-gray-300 px-3 py-2 text-base font-semibold">Action</div>
      <Section title="Alerts">
        {alerts.map((a) => {
          const isActive = alertStates[a.label] !== false;
          return (
            <button
              key={a.label}
              onClick={() => toggleAlert(a.label)}
              className={`block w-full text-left px-2 py-1.5 text-sm border cursor-pointer ${
                isActive
                  ? "border-gray-400 bg-gray-50 text-black"
                  : "border-gray-300 bg-white text-gray-700"
              }`}
            >
              {a.label}: {a.status || (isActive ? "on" : "off")}
            </button>
          );
        })}
        {!alerts.length && <p className="m-0 text-sm text-gray-600">No alerts.</p>}
      </Section>

      <Section title="Recent">
        <p className="m-0 text-sm text-gray-600">No recent items.</p>
      </Section>

      <Section title="Viewed">
        <p className="m-0 text-sm text-gray-600">No viewed items.</p>
      </Section>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section id={title.toLowerCase()} className="px-3 py-3 border-b border-gray-200 last:border-b-0">
      <h4 className="m-0 mb-2 text-base font-semibold text-black">
        {title}
      </h4>
      <div className="grid gap-2">
        {children}
      </div>
    </section>
  );
}
