/** Plain-text evidence from a public article page; never executable HTML. */
export interface NewsDocument {
  articleId: string;
  requestedUrl: string;
  finalUrl: string | null;
  fetchedAt: string;
  method: "readability-0.6.0";
  status: "available" | "truncated" | "unsupported" | "restricted" | "unavailable" | "empty" | "title-mismatch";
  title: string | null;
  byline: string | null;
  publishedTime: string | null;
  paragraphs: Array<{ id: string; text: string }>;
  contentHash: string | null;
  extractedCharacters: number;
  retainedCharacters: number;
  reason: string;
}
