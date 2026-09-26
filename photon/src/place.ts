/** Place code only when the text or URL already names one. */
export function knownJurisdiction(text: string, url?: string): string | undefined {
  const blob = `${text} ${url ?? ""}`.toLowerCase();
  if (blob.includes("california")) return "US-CA";
  if (blob.includes("congress.gov") || /\b(senate|house)\b/.test(blob)) return "US";
  return undefined;
}
