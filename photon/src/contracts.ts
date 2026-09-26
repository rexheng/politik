export type Category = "bill-stuck" | "local-worry" | "lab-money" | "research" | "speech" | "other";

export type SourceName = "browserbase" | "elevenlabs" | "openalex" | "pitchbook" | "briefing";

export interface SourceItem {
  id: string;
  source: SourceName;
  title: string;
  plain: string;
  url?: string;
  happenedAt?: string;
  jurisdiction?: string;
}

export interface TaggedItem extends SourceItem {
  category: Category;
  tags: string[];
}

export interface AskRequest {
  message: string;
}

export interface AskCard {
  title: string;
  plain: string;
  source?: string;
  url?: string;
  fetched?: string;
  jurisdiction?: string;
}

export interface AskResponse {
  reply: string;
  category: Category;
  items: AskCard[];
}
