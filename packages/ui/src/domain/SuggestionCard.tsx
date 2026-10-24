import { PERSONA_LABEL, RECEPTIVITY_LABEL, type Suggestion, type SuggestionAction, MOMENT_META } from '@cue/core';
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { cx } from '../lib/cx';
import { Button, IconButton } from '../primitives/Button';
import { Kbd } from '../primitives/Chip';
import { TextArea } from '../primitives/Field';
import { MomentChip } from './MomentChip';

export type OnSuggestionAction = (suggestionId: string, action: SuggestionAction, text?: string) => void;

export interface SuggestionCardProps {
  suggestion: Suggestion;
  onAction?: OnSuggestionAction;
  size?: 'hero' | 'compact';
  showEvidence?: boolean;
  /** Controlled edit mode (for keyboard shortcuts). Leave undefined to let the card manage it. */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  /** Show provenance details (served by, latency, Mubit request ids) in the footer. */
  debug?: boolean;
  /** The cue's number in the call (1-based), printed in the margin as Q07. */
  cue?: number;
  /** Show keyboard hints (U, D, E) on the actions. Only where the app binds them. */
  shortcuts?: boolean;
  className?: string;
}

/** Imperative handle so apps can drive the card from keyboard shortcuts. */
export interface SuggestionCardHandle {
  use(): void;
  dismiss(): void;
  edit(): void;
  thumbsUp(): void;
  thumbsDown(): void;
}

/** Honest, quiet provenance: never present a fallback as the model. */
export function provenanceNote(s: Pick<Suggestion, 'servedBy'>): string | null {
  if (s.servedBy === 'rules') return 'Playbook line as written · model offline';
  if (s.servedBy === 'cache') return 'Cached line';
  return null;
}

const BASIS_TAG: Record<Suggestion['evidence']['basis'], string | null> = { bandit: null, explore: 'On trial', model: 'New line' };

/** "Cold CEO", "Gatekeeper", "Warm CFO": the situation in two words. */
export function situationLabel(s: Suggestion['situation']): string {
  if (s.persona === 'gatekeeper' && s.moment === 'gatekeeper') return '';
  const who = PERSONA_LABEL[s.persona];
  if (s.persona === 'gatekeeper' || s.persona === 'unknown') return who;
  return `${RECEPTIVITY_LABEL[s.receptivity]} ${who}`;
}

/** Q07: the cue number, zero-padded the way a prompt book prints it. */
export function cueLabel(n: number): string {
  return `Q${String(Math.max(0, Math.floor(n))).padStart(2, '0')}`;
}

/** The line, wrapped in hanging curly quotes drawn in the moment colour. */
export function Line({ text, id, size }: { text: string; id?: string; size: 'hero' | 'compact' }) {
  return (
    <p className={cx('cue-line', size === 'compact' && 'cue-line--compact')} id={id}>
      <span className="cue-line__q cue-line__q--open" aria-hidden>
        “
      </span>
      {text}
      <span className="cue-line__q" aria-hidden>
        ”
      </span>
    </p>
  );
}

const TALLY = 20;

/**
 * The evidence as a tally strip: twenty ticks, filled in proportion to how often the line won here.
 * The words beside it carry the numbers; the strip is for the corner of the eye.
 */
export function Tally({ rate, label }: { rate: number; label?: string }) {
  const on = Math.round(Math.max(0, Math.min(1, rate)) * TALLY);
  return (
    <span className="cue-tally" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {Array.from({ length: TALLY }, (_, i) => (
        <i key={i} className={i < on ? 'is-on' : undefined} />
      ))}
    </span>
  );
}

/**
 * The hero of Cue, set like a cue in a prompt book: a slug line (cue number, moment, who), the line
 * to say, a tally of the evidence, and the rep's actions on a ruled footer. The moment colour lives
 * in the margin rule and the quotes, nowhere else. Long strings wrap anywhere; nothing overflows.
 */
export const SuggestionCard = forwardRef<SuggestionCardHandle, SuggestionCardProps>(function SuggestionCard(
  { suggestion: s, onAction, size = 'hero', showEvidence = true, editing: editingProp, onEditingChange, debug, cue, shortcuts, className },
  ref,
) {
  const lineId = useId();
  const meta = MOMENT_META[s.situation.moment];
  const [acted, setActed] = useState<SuggestionAction | null>(null);
  const [editingInner, setEditingInner] = useState(false);
  const editing = editingProp ?? editingInner;
  const setEditing = (v: boolean) => {
    if (editingProp === undefined) setEditingInner(v);
    onEditingChange?.(v);
  };
  const [draft, setDraft] = useState(s.say);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setActed(null);
    setEditingInner(false);
    setDraft(s.say);
  }, [s.id, s.say]);
  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  const act = (a: SuggestionAction, text?: string) => {
    setActed(a);
    onAction?.(s.id, a, text);
  };
  useImperativeHandle(ref, () => ({
    use: () => act('used'),
    dismiss: () => act('dismissed'),
    edit: () => setEditing(true),
    thumbsUp: () => act('thumbs_up'),
    thumbsDown: () => act('thumbs_down'),
  }));
  const tag = BASIS_TAG[s.evidence.basis];
  const who = situationLabel(s.situation);
  const note = provenanceNote(s);
  const compact = size === 'compact';
  const rate = s.evidence.winRate;

  return (
    <article className={cx('cue-card', `cue-card--${size}`, `cue-fam-${meta.family}`, acted === 'used' && 'is-used', className)} aria-labelledby={lineId} data-moment={s.situation.moment}>
      <header className="cue-card__slug">
        {cue !== undefined && <span className="cue-card__cue">{cueLabel(cue)}</span>}
        <MomentChip moment={s.situation.moment} size={compact ? 'sm' : 'md'} />
        {who && <span className="cue-card__who">{who}</span>}
        {tag && <span className="cue-card__basis">{tag}</span>}
      </header>

      {editing ? (
        <form
          className="cue-card__edit"
          onSubmit={(e) => {
            e.preventDefault();
            const text = draft.trim();
            if (text) act('edited', text);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setEditing(false);
              setDraft(s.say);
            }
          }}
        >
          <TextArea ref={editRef} label="Say it your way" value={draft} maxLength={400} onChange={(e) => setDraft(e.target.value)} hint="Cue learns from your edits." />
          <div className="cue-card__edit-actions">
            <Button type="submit" variant="primary" size="sm" icon="check">
              Save line
            </Button>
            <Button size="sm" variant="ghost" onClick={() => (setEditing(false), setDraft(s.say))}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Line text={acted === 'edited' ? draft : s.say} id={lineId} size={size} />
      )}

      {showEvidence && !editing && (
        <p className="cue-card__evidence">
          {rate !== undefined && s.evidence.calls > 0 && <Tally rate={rate} />}
          <span className="cue-card__evidence-text">{s.evidence.text}</span>
        </p>
      )}

      {onAction && !editing && (
        <footer className="cue-card__actions">
          <Button
            size={compact ? 'sm' : 'md'}
            variant={acted === 'used' ? 'secondary' : 'primary'}
            icon="check"
            aria-pressed={acted === 'used'}
            className="cue-card__use"
            onClick={() => act('used')}
          >
            {acted === 'used' ? 'Used' : 'Used it'}
            {shortcuts && acted !== 'used' && (
              <span aria-hidden>
                <Kbd keys={['U']} />
              </span>
            )}
          </Button>
          <span className="cue-card__tools" role="group" aria-label="Rate or change the line">
            <IconButton icon="thumbs-up" label="Good suggestion" size="sm" pressed={acted === 'thumbs_up'} onClick={() => act('thumbs_up')} />
            <IconButton icon="thumbs-down" label="Not helpful" size="sm" pressed={acted === 'thumbs_down'} onClick={() => act('thumbs_down')} />
            <IconButton icon="edit" label="Edit the line" size="sm" onClick={() => setEditing(true)} />
            <IconButton icon="close" label="Dismiss" size="sm" onClick={() => act('dismissed')} />
          </span>
        </footer>
      )}
      {(debug || (note && !compact)) && !editing && (
        <p className={cx('cue-card__note', s.servedBy !== 'mubit' && 'is-fallback')} title={s.mubitRequestIds.join(', ') || undefined}>
          {note ?? 'Tailored by Mubit'}
          {debug && (
            <span className="cue-card__debug">
              {' '}
              · {s.servedBy} · {s.latencyMs} ms{s.mubitRequestIds.length > 0 && <> · <code>{s.mubitRequestIds.at(-1)}</code></>}
            </span>
          )}
        </p>
      )}
    </article>
  );
});
