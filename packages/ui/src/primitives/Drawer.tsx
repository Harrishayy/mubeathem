import { useId, useState, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { Icon, type IconName } from './Icon';

export interface DrawerProps {
  title: ReactNode;
  icon?: IconName;
  /** Small trailing text or a count badge in the header. */
  meta?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  className?: string;
}

/**
 * Inline collapsible section (a disclosure). Height animates with the grid-rows trick, which is
 * interruptible and needs no measuring. Content stays mounted so scroll position survives.
 */
export function Drawer({ title, icon, meta, open, defaultOpen = false, onOpenChange, children, className }: DrawerProps) {
  const [inner, setInner] = useState(defaultOpen);
  const isOpen = open ?? inner;
  const id = useId();
  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setInner(next);
    onOpenChange?.(next);
  };
  return (
    <section className={cx('cue-drawer', isOpen && 'is-open', className)}>
      <h3 className="cue-drawer__heading">
        <button type="button" className="cue-drawer__trigger" aria-expanded={isOpen} aria-controls={id} onClick={toggle}>
          <Icon name="chevron" size={14} className="cue-drawer__chev" />
          {icon && <Icon name={icon} size={15} />}
          <span className="cue-drawer__title">{title}</span>
          {meta !== undefined && <span className="cue-drawer__meta">{meta}</span>}
        </button>
      </h3>
      <div className="cue-drawer__panel" id={id} role="region" aria-hidden={!isOpen} inert={!isOpen || undefined}>
        <div className="cue-drawer__inner">
          <div className="cue-drawer__content">{children}</div>
        </div>
      </div>
    </section>
  );
}
