// Phone normalization to E.164. Russian local formats are accepted:
// 8 999 123-45-67, 9991234567, +7 (999) 123-45-67.
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  let e164: string;
  if (trimmed.startsWith('+')) e164 = `+${digits}`;
  else if (digits.length === 11 && (digits.startsWith('8') || digits.startsWith('7'))) e164 = `+7${digits.slice(1)}`;
  else if (digits.length === 10 && digits.startsWith('9')) e164 = `+7${digits}`;
  else e164 = `+${digits}`;
  return /^\+\d{10,15}$/.test(e164) ? e164 : null;
}

export function formatPhone(e164: string): string {
  const m = e164.match(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+7 ${m[1]} ${m[2]}-${m[3]}-${m[4]}` : e164;
}
