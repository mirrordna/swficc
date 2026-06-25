"use client";

import { useEffect } from "react";

export default function StaleCacheGuard() {
  useEffect(() => {
    void navigator.serviceWorker?.getRegistrations?.().then((registrations) => {
      registrations.forEach((registration) => {
        void registration.unregister();
      });
    }).catch(() => {});

    void globalThis.caches?.keys?.().then((keys) => {
      keys.forEach((key) => {
        void globalThis.caches.delete(key);
      });
    }).catch(() => {});
  }, []);

  return null;
}
