/**
 * @cue/ui: Cue's design system. Tokens and styles are plain CSS (`@cue/ui/styles.css`, or
 * `@cue/ui/styles.css?inline` for a Shadow DOM); components render inside <CueRoot>.
 */

// root and theming
export { CueRoot, useCue, type CueRootProps, type Direction, type ThemePref, type Density, type MotionPref } from './domain/CueRoot';
export { FONT_HREF, FONT_FAMILIES } from './fonts';

// mascot
export { Sprout, SPROUT_LABEL, type SproutProps } from './mascot/Sprout';

// primitives
export { Icon, ICON_NAMES, iconFor, type IconName, type IconProps } from './primitives/Icon';
export { Button, IconButton, type ButtonProps, type IconButtonProps, type ButtonVariant, type ButtonSize } from './primitives/Button';
export { Chip, Kbd, VisuallyHidden, type ChipProps, type ChipTone } from './primitives/Chip';
export { Tooltip } from './primitives/Tooltip';
export { Switch, type SwitchProps } from './primitives/Switch';
export { SegmentedControl, type SegmentedControlProps, type SegmentedOption } from './primitives/SegmentedControl';
export { TextField, TextArea, type TextFieldProps, type TextAreaProps } from './primitives/Field';
export { Rating, type RatingProps } from './primitives/Rating';
export { Dialog, type DialogProps } from './primitives/Dialog';
export { Drawer, type DrawerProps } from './primitives/Drawer';
export { Sheet, type SheetProps, type SheetSnap } from './primitives/Sheet';
export { Toast, ToastRegion, type ToastData, type ToastTone } from './primitives/Toast';
export { Skeleton, EmptyState, ErrorState, type EmptyStateProps, type ErrorStateProps } from './primitives/Feedback';
export { Meter, Sparkline, type MeterProps, type SparklineProps } from './primitives/Meter';
export { ScrollArea, type ScrollAreaProps } from './primitives/ScrollArea';
export { Pane, PaneSection, Hint, Kpi, KpiStrip, KeyValue, StatGrid, ActionBar, Bar, type PaneProps, type PaneTab, type KpiProps, type KeyValueItem } from './primitives/Pane';
export { DataTable, type DataTableProps, type Column } from './primitives/DataTable';
export { AppBar, BandTag, CueMark, type AppBarProps, type AppTab } from './primitives/AppBar';

// domain
export { Overbar, CueStage, type OverbarProps, type OverbarMode, type OverbarPlacement, type CueStageProps } from './domain/Overbar';
export { SuggestionCard, Line, Tally, cueLabel, situationLabel, provenanceNote, type SuggestionCardProps, type SuggestionCardHandle, type OnSuggestionAction } from './domain/SuggestionCard';
export { ComplianceCard, VERDICT_LABEL, type ComplianceCardProps } from './domain/ComplianceCard';
export { MomentChip, momentParts, smartQuotes, type MomentChipProps } from './domain/MomentChip';
export { PersonaChip, type PersonaChipProps } from './domain/PersonaChip';
export { ReceptivityMeter, type ReceptivityMeterProps } from './domain/ReceptivityMeter';
export { UpNextList, type UpNextListProps } from './domain/UpNextList';
export { CallTimer, type CallTimerProps } from './domain/CallTimer';
export { ProspectHeader, type ProspectHeaderProps } from './domain/ProspectHeader';
export { TranscriptView, type TranscriptViewProps } from './domain/TranscriptView';
export { BriefView, viaLabel, type BriefViewProps } from './domain/BriefView';
export { FlagsView } from './domain/FlagsView';
export { ConnectionPill } from './domain/ConnectionPill';
export { DebriefForm, DEBRIEF_OUTCOMES, type DebriefFormProps } from './domain/DebriefForm';
export { PlaybookBoard, type PlaybookBoardProps } from './domain/PlaybookBoard';
export { ModelGrowthPanel, TASK_COPY, TASK_LABEL, type ModelGrowthPanelProps } from './domain/ModelGrowthPanel';
export { OutcomeBar, type OutcomeBarProps } from './domain/OutcomeBar';
export { CallTimeline, packRows, type CallTimelineProps } from './domain/CallTimeline';

export { MASCOT_STATES, formatUsd, formatMs, type Connection, type MascotState } from './lib/core';
export { Board, BoardSection, Screen, Toolbar, SectionNav, type BoardSectionProps, type SectionLink } from './primitives/Board';
export { useChromeHeight } from './lib/useChromeHeight';
export { Workspace, FoldSideButton, useWorkspace, type WorkspaceProps, type WorkspaceSideProps, type WorkspaceApi, type WorkspaceSide } from './primitives/Workspace';
