/**
 * Web fonts. Apps add one <link rel="stylesheet" href={FONT_HREF}> to the document (in the extension,
 * to the host page's head: @font-face doesn't load from inside a Shadow DOM). Until they load,
 * metric-matched local fallbacks in tokens/base.css keep layout steady.
 *
 * - Newsreader: the line's voice face (Honey, Night). A text serif with optical sizes; reads like
 *   something said, not UI chrome.
 * - Schibsted Grotesk: UI and body. A sturdy newspaper grotesk, tabular figures for timers.
 * - Atkinson Hyperlegible Next: Signal. Built for low vision; distinct letterforms at a glance.
 * - Spline Sans Mono: the margin voice. Slug lines, tags, eyebrows, counts, timers, request ids.
 */
export const FONT_FAMILIES = ['Newsreader', 'Schibsted Grotesk', 'Atkinson Hyperlegible Next', 'Spline Sans Mono'] as const;

export const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400..700;1,6..72,400..600&family=Schibsted+Grotesk:wght@400..800&family=Atkinson+Hyperlegible+Next:wght@400..800&family=Spline+Sans+Mono:wght@400..600&display=swap';
