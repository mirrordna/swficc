"use client";

import { useState, FormEvent } from "react";
import type { SmartSearch } from "@/lib/types";

interface TopNavProps {
  search?: SmartSearch;
  onSearch?: (query: string) => void;
}

export default function TopNav({ search, onSearch }: TopNavProps) {
  const [query, setQuery] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim() && onSearch) onSearch(query.trim());
    else if (query.trim()) window.location.href = `/ask-swfi?q=${encodeURIComponent(query)}`;
  };

  const handleSuggestion = (suggestion: string) => {
    setQuery(suggestion);
    if (onSearch) onSearch(suggestion);
  };

  return (
    <nav className="sticky top-0 z-50 h-14 bg-[#0a1628] text-white grid grid-cols-[auto_1fr_auto] items-center gap-4 px-5">
      {/* Logo */}
      <div className="flex items-center gap-3">
        <a href="/" className="flex items-center gap-2 text-white no-underline">
          <span className="text-red-600 text-lg">&#9670;</span>
          <span className="font-bold text-lg tracking-wide">SWFI</span>
        </a>
      </div>

      {/* Smart Search Bar — center */}
      <div className="relative max-w-[640px] w-full justify-self-center">
        <form onSubmit={handleSubmit} className="flex items-center bg-white/[0.12] border border-white/20 rounded-lg overflow-hidden focus-within:bg-white/[0.18] focus-within:border-white/40 transition-all">
          <label className="flex items-center flex-1 gap-2 px-3">
            <svg className="w-5 h-5 opacity-60 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={search?.placeholder || "Search: Institution, Person, Strategy..."}
              className="flex-1 h-9 bg-transparent border-0 text-white text-sm outline-none placeholder:text-white/50"
            />
          </label>
          <button type="submit" className="h-9 px-4 bg-[#a61c20] border-0 text-white text-xs font-semibold uppercase tracking-wider cursor-pointer hover:bg-[#8b1518] transition-colors">
            Search
          </button>
        </form>
        {/* AI Suggestions dropdown */}
        {search?.suggestions && search.suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 flex flex-wrap gap-1.5 pt-2 z-50">
            {search.suggestions.map((s) => (
              <button
                key={s.query}
                type="button"
                onClick={() => handleSuggestion(s.query)}
                className="px-3 py-1.5 text-xs bg-white/10 border border-white/20 rounded-full text-white/80 hover:bg-white/20 hover:text-white cursor-pointer transition-all"
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right — Profile + Alerts */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-white/70">Signed in</span>
        <a href="/profiles" className="w-9 h-9 rounded-full bg-white/10 border border-white/15 flex items-center justify-center hover:bg-white/20 transition-colors" title="Profile">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-7 8-7s8 3 8 7" />
          </svg>
        </a>
        <button className="relative w-9 h-9 rounded-full bg-white/10 border border-white/15 flex items-center justify-center hover:bg-white/20 transition-colors cursor-pointer" title="Alerts">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-red-600" />
        </button>
      </div>
    </nav>
  );
}
