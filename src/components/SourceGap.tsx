"use client";

export default function SourceGap({ message = "This module will populate when SWFI.com discloses approved factual rows." }: { message?: string }) {
  return (
    <div className="border border-gray-300 bg-gray-50 px-3 py-3">
      <strong className="block text-sm text-gray-700">Not disclosed</strong>
      <p className="m-0 mt-1 text-xs leading-relaxed text-gray-500">{message}</p>
    </div>
  );
}
