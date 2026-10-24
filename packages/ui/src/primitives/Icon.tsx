import type { SVGProps } from 'react';

/**
 * Cue's icon set: 24-unit grid, 1.75 stroke, round joins, drawn to read at 14–20 px. Moment icon
 * names come from MOMENT_META[moment].icon in @cue/core. Never an emoji in UI chrome.
 */
const PATHS = {
  wave: 'M7.5 12.5 5.2 10.2a1.6 1.6 0 0 1 2.3-2.3l4 4M9.6 8.2 8 6.6a1.6 1.6 0 0 1 2.3-2.3l4.8 4.8M12.2 6.3a1.6 1.6 0 0 1 2.3-2.3l3.4 3.4c2.9 2.9 2.9 7.2 0 10.1a7.1 7.1 0 0 1-10.1 0l-3.6-3.6a1.6 1.6 0 0 1 2.3-2.3l1.2 1.2M17 2.5c1.6.5 3 1.9 3.5 3.5M3.5 17c.5 1.6 1.9 3 3.5 3.5',
  door: 'M5 21V4.5A1.5 1.5 0 0 1 6.5 3h8A1.5 1.5 0 0 1 16 4.5V21M3 21h18M16 6h2.5A1.5 1.5 0 0 1 20 7.5V21M12.5 12.5v.01',
  question: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.4 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.4-2.6 4M12 17.3v.01',
  mail: 'M4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11A1.5 1.5 0 0 1 4.5 5ZM3.5 6.5l7.6 6a1.5 1.5 0 0 0 1.8 0l7.6-6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.2 2',
  shield: 'M12 21s7-3.2 7-9.5V5.8L12 3 5 5.8v5.7C5 17.8 12 21 12 21ZM9 12l2.2 2.2L15.3 10',
  spark: 'M12 3.5c.6 3.9 2.4 6.3 6.5 7.5-4.1 1.2-5.9 3.6-6.5 7.5-.6-3.9-2.4-6.3-6.5-7.5 4.1-1.2 5.9-3.6 6.5-7.5ZM18.5 2.5v3.5M16.75 4.25h3.5',
  calendar: 'M5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5ZM4 10h16M8.5 3v4M15.5 3v4M9 14.5l2 2 4-4',
  chat: 'M20 11.5c0 4.1-3.6 7.5-8 7.5-1.2 0-2.3-.2-3.3-.6L4 20l1.2-3.9A7.2 7.2 0 0 1 4 11.5C4 7.4 7.6 4 12 4s8 3.4 8 7.5Z',
  alert: 'M10.3 4.2 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0ZM12 9.5v4M12 16.8v.01',
  voicemail: 'M6.5 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM17.5 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM6.5 16h11',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  dot: 'M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  mic: 'M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 1 0-7 0v5A3.5 3.5 0 0 0 12 15ZM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21',
  'mic-off': 'M3 3l18 18M8.5 8.5v3a3.5 3.5 0 0 0 5.6 2.8M15.5 11V6.5a3.5 3.5 0 0 0-6.8-1.2M5.5 11a6.5 6.5 0 0 0 10.4 5.2M18.5 11c0 .9-.2 1.8-.5 2.6M12 17.5V21',
  phone: 'M8.6 3.8 6.3 3.2a1.6 1.6 0 0 0-1.8.9C3.6 6 3.2 8.4 4.4 11.4a17 17 0 0 0 8.2 8.2c3 1.2 5.4.8 7.3-.1a1.6 1.6 0 0 0 .9-1.8l-.6-2.3a1.6 1.6 0 0 0-1.9-1.2l-2.6.7a12 12 0 0 1-4.6-4.6l.7-2.6a1.6 1.6 0 0 0-1.2-1.9Z',
  'phone-off': 'M3.2 14.6c4.9-4.8 12.7-4.8 17.6 0l-1.5 2.3a1.4 1.4 0 0 1-1.8.5l-2.7-1.3a1.4 1.4 0 0 1-.8-1.4l.2-1.7a11.5 11.5 0 0 0-4.4 0l.2 1.7a1.4 1.4 0 0 1-.8 1.4l-2.7 1.3a1.4 1.4 0 0 1-1.8-.5Z',
  chevron: 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  expand: 'M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5',
  collapse: 'M20 10h-6V4M4 14h6v6M14 10l6.5-6.5M10 14l-6.5 6.5',
  pin: 'M15 3.5 20.5 9l-3 1-3.7 3.7.6 4.3-1.4 1.4-3.7-3.7L4 21l5.3-5.3-3.7-3.7L7 10.6l4.3.6L15 7.5l0-4Z',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
  close: 'M6 6l12 12M18 6 6 18',
  'thumbs-up': 'M7.5 10.5V20M7.5 10.5 11 3.6a2 2 0 0 1 3.4 1.8L13.6 9h4.9a2 2 0 0 1 2 2.4l-1.4 6.8A2.2 2.2 0 0 1 17 20H7.5M7.5 10.5H5A1.5 1.5 0 0 0 3.5 12v6.5A1.5 1.5 0 0 0 5 20h2.5',
  'thumbs-down': 'M16.5 13.5V4M16.5 13.5 13 20.4a2 2 0 0 1-3.4-1.8l.8-3.6H5.5a2 2 0 0 1-2-2.4l1.4-6.8A2.2 2.2 0 0 1 7 4h9.5M16.5 13.5H19a1.5 1.5 0 0 0 1.5-1.5V5.5A1.5 1.5 0 0 0 19 4h-2.5',
  edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4ZM13.5 6.5l4 4',
  copy: 'M9.5 9h9A1.5 1.5 0 0 1 20 10.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 8 19.5v-9A1.5 1.5 0 0 1 9.5 9ZM16 9V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8',
  external: 'M14 4h6v6M20 4l-8.5 8.5M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10',
  brief: 'M7.5 3.5H14l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H7.5A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1.5-1.5ZM14 3.5V8h4.5M9 12.5h6M9 16h4',
  sprout: 'M12 21v-8.5M12 12.5C12 8.4 9 6 4.5 6c0 4.1 3 6.5 7.5 6.5ZM12 10.5C12 6.9 14.7 4 19.5 4c0 3.6-2.7 6.5-7.5 6.5ZM7 21h10',
  'wifi-off': 'M3 3l18 18M8.6 16.1a4.8 4.8 0 0 1 6.8 0M5.2 12.6a9.6 9.6 0 0 1 4.2-2.4M18.8 12.6a9.6 9.6 0 0 0-3-2M2 9.1a14.5 14.5 0 0 1 4-2.6M22 9.1A14.5 14.5 0 0 0 11 5.3M12 19.6v.01',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  grip: 'M9 6v.01M15 6v.01M9 12v.01M15 12v.01M9 18v.01M15 18v.01',
  leaf: 'M5 19C5 10 10.5 5 20 5c0 9.5-5 15-14 15M5 19l7-7',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5.5M12 7.8v.01',
  refresh: 'M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4',
  play: 'M7 4.8v14.4a1 1 0 0 0 1.5.9l11.3-7.2a1 1 0 0 0 0-1.7L8.5 3.9A1 1 0 0 0 7 4.8Z',
  pause: 'M8 4.5v15M16 4.5v15',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  'arrow-up-right': 'M7 17 17 7M8 7h9v9',
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

/** Narrows a string (e.g. MOMENT_META[m].icon) to an icon name, falling back to `dot`. */
export function iconFor(name: string): IconName {
  return name in PATHS ? (name as IconName) : 'dot';
}

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  /** Give the icon a meaning for assistive tech; otherwise it is decorative. */
  label?: string;
}

/** Inline SVG icon. Decorative (aria-hidden) unless `label` is passed. */
export function Icon({ name, size = 16, label, className, strokeWidth, ...rest }: IconProps) {
  const filled = name === 'dot' || name === 'play';
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth ?? 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={['cue-icon', className].filter(Boolean).join(' ')}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
