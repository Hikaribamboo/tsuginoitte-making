export function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function envUsiOptions(name: string): Array<[string, string]> {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return [];
  return raw
    .split(/[;\n]/)
    .map((entry): [string, string] | null => {
      const index = entry.indexOf("=");
      if (index <= 0) return null;
      const optionName = entry.slice(0, index).trim();
      const optionValue = entry.slice(index + 1).trim();
      if (!optionName || !optionValue) return null;
      return [optionName, optionValue];
    })
    .filter((entry): entry is [string, string] => Boolean(entry));
}
