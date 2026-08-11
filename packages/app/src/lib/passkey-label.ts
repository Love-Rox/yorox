/**
 * パスキーの表示ラベルを整形する。
 * 旧実装は navigator.platform をそのまま保存していたため、
 * "MacIntel" などの生値が残っている。表示時に読み替える。
 */
const LEGACY_PLATFORM_LABELS = new Map<string, string>([
  ['MacIntel', 'Mac'],
  ['MacPPC', 'Mac'],
  ['Win32', 'Windows'],
  ['Win64', 'Windows'],
  ['iPhone', 'iPhone'],
  ['iPad', 'iPad'],
]);

export function formatPasskeyLabel(label: string | null): string {
  if (!label) return 'パスキー';
  const mapped = LEGACY_PLATFORM_LABELS.get(label);
  if (mapped) return mapped;
  if (/^Linux\b/.test(label)) return 'Linux';
  return label;
}
