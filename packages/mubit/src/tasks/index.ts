import type { TaskId } from '@cue/core';
import { checkClaim } from './check-claim';
import { readMoment } from './read-moment';
import { researchBrief } from './research-brief';
import { reviewCall } from './review-call';
import { simulateProspect } from './simulate-prospect';
import type { TaskDef } from './types';
import { writeLine } from './write-line';

export type { TaskDef } from './types';

export const TASKS: { [K in TaskId]: TaskDef<K> } = {
  read_moment: readMoment,
  write_line: writeLine,
  research_brief: researchBrief,
  check_claim: checkClaim,
  review_call: reviewCall,
  simulate_prospect: simulateProspect,
};

export { checkClaim, readMoment, researchBrief, reviewCall, simulateProspect, writeLine };
