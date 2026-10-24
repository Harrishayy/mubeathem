/**
 * The server's view of @cue/trellus (workstream 03). Its `CallSource` interface is aliased to
 * `OutcomeSource` because @cue/core already exports a `CallSource` (the call's origin enum).
 */
export {
  createTrellusClient,
  loadTrellusConfig,
  TrellusSource,
  NativeSource,
  createOutcomePoller,
  importedCallToEvents,
  buildDispositionMap,
  learnDispositions,
  extractVocabulary,
  NATIVE_DISPOSITIONS,
  type TrellusClient,
  type DispositionMap,
  type CallSource as OutcomeSource,
  type ImportedCall,
  type OutcomePoller,
  type OpenCall,
  type FetchLike,
} from '@cue/trellus';
