import type { Model } from '@earendil-works/pi-ai';
import type { ThinkingLevel } from '../../types.ts';
import type { AgentHarnessOptions, Session } from '../types.ts';

export interface SessionOperationContext {
  session: Session;
  model: Model<string>;
  thinkingLevel: ThinkingLevel;
  signal: AbortSignal;
  getApiKeyAndHeaders?: AgentHarnessOptions['getApiKeyAndHeaders'];
}
