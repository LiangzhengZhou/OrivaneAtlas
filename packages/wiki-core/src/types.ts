export interface WikiLink {
  targetText: string;
  alias: string | null;
  heading: string | null;
  start: number;
  end: number;
  embed: boolean;
}

export interface WikiHeading {
  text: string;
  slug: string;
  level: number;
}
