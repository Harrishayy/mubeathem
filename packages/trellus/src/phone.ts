/**
 * Phone numbers arrive as "+1 (415) 555-0142", "415.555.0142", "0044 20 7946 0958" or
 * "4155550142 x12". Normalise to E.164-ish (`+` and digits, extension dropped) so a HubSpot
 * number and a Trellus `customer_address` compare equal.
 */
export function normalisePhone(raw: string | null | undefined, defaultCountryCode = '1'): string | null {
  if (!raw) return null;
  const withoutExt = raw.replace(/\s*(?:ext\.?|extension|x|#)\s*\d+\s*$/i, '');
  const plus = withoutExt.trim().startsWith('+');
  let digits = withoutExt.replace(/\D/g, '');
  if (digits.length < 7) return null;
  if (plus) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith(defaultCountryCode)) return `+${digits}`;
  digits = digits.replace(/^0+/, '');
  return `+${digits}`;
}

/** Equal after normalising, or the same last 10 digits when both have at least 10 (country code missing on one side). */
export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalisePhone(a);
  const nb = normalisePhone(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const da = na.slice(1);
  const db = nb.slice(1);
  return da.length >= 10 && db.length >= 10 && da.slice(-10) === db.slice(-10);
}

/** Extension digits, when the raw number carried one. */
export function phoneExtension(raw: string): string | null {
  return /(?:ext\.?|extension|x|#)\s*(\d+)\s*$/i.exec(raw)?.[1] ?? null;
}
