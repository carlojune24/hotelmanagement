/**
 * @mm/finance-core/posting — the shape a posting rule takes. No registry here: each
 * app keeps its own registry of `source_type -> PostingRule` (the events and the DB
 * access needed to build a draft are entirely app-local).
 */
import type { JournalEntryDraft } from './journal';

export type PostingRule<TEvent> = (event: TEvent) => JournalEntryDraft;
