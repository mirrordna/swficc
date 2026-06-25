"use client";

import { useState, FormEvent } from "react";
import type { SmartSearch } from "@/lib/types";
import { appHref } from "@/lib/selfContainedLinks";

interface TopNavProps {
  search?: SmartSearch;
  onSearch?: (query: string) => void;
}

export default function TopNav({ search, onSearch }: TopNavProps) {
  const [query, setQuery] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  const navigateToSearch = (value: string) => {
    window.location.assign(appHref(`/search/?q=${encodeURIComponent(value.trim())}`));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim() && onSearch) onSearch(query.trim());
    else if (query.trim()) navigateToSearch(query);
  };

  const handleSuggestion = (suggestion: string) => {
    setQuery(suggestion);
    setSuggestionsOpen(false);
    if (onSearch) onSearch(suggestion);
    else navigateToSearch(suggestion);
  };

  return (
    <nav className="z-50 h-auto bg-white text-black grid grid-cols-1 items-center border-b border-gray-300 md:h-14 md:grid-cols-[190px_1fr_130px_150px]">
      <div className="h-full flex items-center border-r border-gray-300 px-4">
        <a href={appHref("/")} className="text-[#11314F] no-underline">
          <span className="block text-[20px] font-bold tracking-[0.05em]">SWFI</span>
          <span className="block text-[8.5px] tracking-[0.06em] text-[#7A8A9B]">SOVEREIGN WEALTH FUND INSTITUTE</span>
        </a>
      </div>

      <div className="relative h-full flex items-center border-r border-gray-300 px-3">
        <form onSubmit={handleSubmit} className="flex w-full items-center gap-2">
          <label className="flex items-center flex-1 gap-2">
            <span aria-hidden="true">Search:</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setSuggestionsOpen(true)}
              onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 120)}
              placeholder={search?.placeholder || "Search: Institution, Person, Strategy..."}
              className="flex-1 h-9 border border-gray-300 bg-white px-2 text-sm outline-none"
            />
          </label>
          <button type="submit" className="h-9 px-3 border border-gray-300 bg-white text-sm cursor-pointer">
            Search
          </button>
        </form>
        {suggestionsOpen && search?.suggestions && search.suggestions.length > 0 && (
          <div className="absolute top-full left-3 right-3 bg-white border border-gray-300 border-t-0 z-50">
            {search.suggestions.map((s) => (
              <button
                key={s.query}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSuggestion(s.query)}
                className="block w-full px-2 py-1.5 text-left text-xs bg-white text-black hover:bg-gray-50 cursor-pointer"
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-full flex items-center border-r border-gray-300 px-3">
        <a href={appHref("/profiles/")} className="text-black no-underline text-base">
          Institutions
        </a>
      </div>

      <div className="h-full flex items-center px-3">
        <a href={appHref("/intelligence/")} className="text-black no-underline text-base">
          Intelligence
        </a>
      </div>
    </nav>
  );
}
