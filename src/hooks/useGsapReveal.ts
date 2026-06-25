"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";

export function useGsapReveal<T extends HTMLElement>() {
  const rootRef = useRef<T | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      const targets = gsap.utils.toArray<HTMLElement>("[data-gsap-reveal]");
      gsap.fromTo(
        targets,
        { y: 8 },
        {
          y: 0,
          duration: 0.28,
          ease: "power1.out",
          stagger: 0.03,
          clearProps: "all",
        },
      );
    }, root);

    return () => ctx.revert();
  }, []);

  return rootRef;
}
