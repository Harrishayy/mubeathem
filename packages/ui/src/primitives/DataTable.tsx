import type { KeyboardEvent, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell content. Long text wraps; nothing is clipped. */
  render: (row: T, index: number) => ReactNode;
  /** CSS width hint (`120px`, `14%`). Leave the main text column without one so it takes the rest. */
  width?: string;
  align?: 'start' | 'end' | 'center';
  /** Tabular mono figures. */
  mono?: boolean;
  /** Visually hide the header text (it stays for screen readers), for action columns. */
  hideHeader?: boolean;
  /** Class on this column's header and cells (e.g. a pinned action column). */
  className?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Accessible name for the table. */
  label: string;
  selectedKey?: string | null;
  /** Makes rows selectable (click, Enter or Space). */
  onSelect?: (row: T) => void;
  /** Extra class per row (e.g. `is-learned`). */
  rowClassName?: (row: T) => string | undefined;
  /** Per-row moment family for the selection rule (`objection` → --m). */
  rowFamily?: (row: T) => string | undefined;
  /** Narrowest the table may get before it scrolls inside its box (never the page). */
  minWidth?: number;
  empty?: ReactNode;
  className?: string;
}

/**
 * The dashboard's table: sticky mono head, ruled rows, wrapping cells. Below `minWidth` it scrolls
 * sideways inside its own box, so a narrow screen never gets page-level overflow and no cell text
 * is truncated. Selectable rows are real buttons to the keyboard (Enter / Space).
 */
export function DataTable<T>({ columns, rows, rowKey, label, selectedKey, onSelect, rowFamily, rowClassName, minWidth = 560, empty, className }: DataTableProps<T>) {
  if (rows.length === 0 && empty) return <div className="cue-table-empty">{empty}</div>;
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(row);
    }
  };
  return (
    <div className={cx('cue-table-wrap', className)} role="region" aria-label={label} tabIndex={0}>
      <table className="cue-table" style={{ minWidth }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" style={c.width ? { width: c.width } : undefined} className={cx(c.align && `is-${c.align}`, c.className)}>
                {c.hideHeader ? <span className="cue-vh">{c.header}</span> : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const k = rowKey(row);
            const selected = selectedKey === k;
            const fam = rowFamily?.(row);
            return (
              <tr
                key={k}
                className={cx(onSelect && 'is-selectable', selected && 'is-selected', fam && `cue-fam-${fam}`, rowClassName?.(row))}
                aria-selected={onSelect ? selected : undefined}
                tabIndex={onSelect ? 0 : undefined}
                onClick={onSelect ? () => onSelect(row) : undefined}
                onKeyDown={onSelect ? (e) => onKey(e, row) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cx(c.mono && 'is-mono', c.align && `is-${c.align}`, c.className)}>
                    {c.render(row, i)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
