export type Category = "bill-stuck" | "local-worry" | "lab-money" | "research" | "speech" | "other";

export type SourceName =
  | "browserbase"
  | "bluesky"
  | "pitchbook"
  | "site"
  | "policy";

export interface SourceItem {
  id: string;
  source: SourceName;
  title: string;
  plain: string;
  url?: string;
  happenedAt?: string;
  jurisdiction?: string;
  author?: string;
}

export interface TaggedItem extends SourceItem {
  category: Category;
  tags: string[];
}
