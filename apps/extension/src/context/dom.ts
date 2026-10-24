/**
 * Small DOM helpers for reading CRM pages we don't control. Every reader tries a list of selectors
 * (newest UI first) and falls back to structure (labels, tel: links, the document title), so one
 * class-name change on HubSpot's side degrades a field instead of breaking the overlay.
 */

/** Collapses whitespace and trims; empty → ''. */
export function clean(s: string | null | undefined, max = 200): string {
  return (s ?? '').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Visible-ish text of an element (inputs give their value). */
export function textOf(el: Element | null | undefined): string {
  if (!el) return '';
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return clean(el.value || el.getAttribute('value'));
  if (el instanceof HTMLSelectElement) return clean(el.selectedOptions[0]?.textContent);
  return clean((el as HTMLElement).innerText ?? el.textContent);
}

/** First non-empty text among the selectors. */
export function firstText(root: ParentNode, selectors: readonly string[]): string {
  for (const sel of selectors) {
    let nodes: NodeListOf<Element>;
    try {
      nodes = root.querySelectorAll(sel);
    } catch {
      continue; // an invalid selector in an old browser must not break the rest
    }
    for (const el of nodes) {
      const t = textOf(el);
      if (t) return t;
    }
  }
  return '';
}

const norm = (s: string) => clean(s).toLowerCase().replace(/[:*]+$/, '').trim();

/**
 * The value shown next to a label ("Job title" → "CEO"), the way CRM property cards lay them out:
 * `<label for>` → input, a `<dt>` → `<dd>`, or a label element followed by its value sibling.
 */
export function labelledValue(root: ParentNode, labels: readonly string[]): string {
  const wanted = new Set(labels.map(norm));
  const candidates = root.querySelectorAll('label, dt, th, [data-label], [class*="label" i], [class*="Label"], span, div');
  for (const el of candidates) {
    // A label holds text only; a container that also holds the value is not the label.
    if (el.children.length > 2 || el.querySelector('input, textarea, select, a, button, dd, td')) continue;
    const own = norm(el.getAttribute('data-label') ?? el.textContent ?? '');
    if (!own || own.length > 40 || !wanted.has(own)) continue;
    if (el instanceof HTMLLabelElement && el.htmlFor) {
      const target = (el.ownerDocument ?? document).getElementById(el.htmlFor);
      const v = textOf(target);
      if (v) return v;
    }
    if (el.tagName === 'DT' && el.nextElementSibling?.tagName === 'DD') {
      const v = textOf(el.nextElementSibling);
      if (v) return v;
    }
    if (el.tagName === 'TH') {
      const v = textOf(el.nextElementSibling);
      if (v) return v;
    }
    // The value is usually the next sibling, or inside the label's parent after it.
    let sib = el.nextElementSibling;
    while (sib) {
      const input = sib.matches('input, textarea, select') ? sib : sib.querySelector('input, textarea, select');
      const v = input ? textOf(input) : textOf(sib);
      if (v && norm(v) !== own) return v;
      sib = sib.nextElementSibling;
    }
    const parentNext = el.parentElement?.nextElementSibling;
    const v = textOf(parentNext);
    if (v && norm(v) !== own) return v;
  }
  return '';
}

const PHONE_RE = /(\+?\d[\d\s().-]{6,}\d)/;

/** A phone number from tel: links, falling back to a labelled field. */
export function readPhone(root: ParentNode, labels: readonly string[] = ['Phone number', 'Phone', 'Mobile phone number', 'Mobile']): string {
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href^="tel:"]')) {
    const raw = decodeURIComponent(a.getAttribute('href')!.slice(4)).trim();
    if (PHONE_RE.test(raw)) return clean(raw, 40);
    const t = textOf(a);
    if (PHONE_RE.test(t)) return clean(t, 40);
  }
  const v = labelledValue(root, labels);
  const m = v.match(PHONE_RE);
  return m ? clean(m[1], 40) : '';
}

export function readEmail(root: ParentNode): string {
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:"]')) {
    const v = clean(decodeURIComponent(a.getAttribute('href')!.slice(7)).split('?')[0], 200);
    if (v.includes('@')) return v;
  }
  return '';
}

/** "Maya Chen | HubSpot" → "Maya Chen". */
export function nameFromTitle(title: string, suffixes: readonly string[]): string {
  let t = clean(title);
  for (const s of suffixes) {
    const i = t.toLowerCase().lastIndexOf(s.toLowerCase());
    if (i > 0) t = t.slice(0, i);
  }
  return clean(t.replace(/[|\-–·•]+\s*$/, ''));
}
