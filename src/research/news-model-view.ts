import { record } from "./references.ts";

// A page line claiming an assistant role and issuing an output directive is source text, not authority.
const ROLE_SPOOF = /(?:^|[.!?。！？]\s+)\s*(?:[【\[]\s*(?:system|developer|assistant|系统|开发者|助手)(?:\s*(?:message|prompt|instruction|消息|指令|提示词))?\s*[】\]]|(?:system|developer|assistant|系统|开发者|助手)(?:\s*(?:message|prompt|instruction|消息|指令|提示词))?\s*[:：])[\s\S]{0,160}(?:\b(?:must|should|print|output|respond|follow|ignore|override|answer)\b|(?:请|必须|直接|输出|回复|回答|遵循|忽略|无视))/imu;

/** A narrow quarantine for page text that directly addresses the assistant or its instructions. */
export function isInstructionLikeNewsText(value: string): boolean {
  // Normalize only for detection; original text, paragraph IDs and hashes remain untouched.
  const text = value.normalize("NFKC").replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, "");
  const prose = text.replace(/\s+/gu, " ");
  return /\b(?:ignore|disregard|override|forget)\b.{0,80}\b(?:(?:the\s+)?user|(?:previous|prior|system|developer)\s+(?:instructions?|prompts?|messages?)|instructions?|prompts?)\b/iu.test(prose)
    || /\b(?:assistant|chatgpt|language model|ai model)\b.{0,120}\b(?:must|should|output|print|respond|ignore|follow)\b/iu.test(prose)
    || /(?:忽略|无视|覆盖).{0,40}(?:用户(?:要求|指令)?|系统(?:指令|提示词)|开发者(?:指令|消息)|提示词)/u.test(prose)
    || /(?:助手|模型|ChatGPT).{0,60}(?:必须|请|输出|回复|忽略)/iu.test(prose)
    || ROLE_SPOOF.test(text);
}

export interface WithheldNewsParagraph { articleId: string; paragraphId: string }

/** Model-only projection. Journal/tool details retain the original paragraphs and content hashes. */
export function projectNewsModelView<T extends object>(value: T): T & {
  modelPresentation: { withheldParagraphs: WithheldNewsParagraph[]; note: string };
} {
  const view = structuredClone(value) as T & { modelPresentation: { withheldParagraphs: WithheldNewsParagraph[]; note: string } };
  const root = view as Record<string, unknown>, withheld: WithheldNewsParagraph[] = [];
  const documents = Array.isArray(root.documents) ? root.documents : [];
  for (const entry of documents) {
    const document = record(entry), articleId = document?.articleId;
    if (!document || typeof articleId !== "string" || !Array.isArray(document.paragraphs)) continue;
    document.paragraphs = document.paragraphs.filter(value => {
      const paragraph = record(value);
      if (!paragraph || typeof paragraph.id !== "string" || typeof paragraph.text !== "string") return false;
      if (!isInstructionLikeNewsText(paragraph.text)) return true;
      withheld.push({ articleId, paragraphId: paragraph.id });
      return false;
    });
    for (const key of ["title", "byline", "publishedTime"] as const) {
      if (typeof document[key] === "string" && isInstructionLikeNewsText(document[key]))
        document[key] = "[Instruction-like page metadata withheld]";
    }
  }
  const withheldByArticle = new Map<string, Set<string>>();
  for (const paragraph of withheld) {
    const ids = withheldByArticle.get(paragraph.articleId) ?? new Set<string>();
    ids.add(paragraph.paragraphId); withheldByArticle.set(paragraph.articleId, ids);
  }
  for (const entry of Array.isArray(root.citations) ? root.citations : []) {
    const citation = record(entry);
    if (citation && typeof citation.articleId === "string" && Array.isArray(citation.paragraphIds))
      citation.paragraphIds = citation.paragraphIds.filter(id => typeof id === "string" && !withheldByArticle.get(citation.articleId as string)?.has(id));
  }
  const news = record(root.news);
  const subject = record(news?.subject);
  if (subject && Array.isArray(subject.names)) subject.names = subject.names.map(name =>
    typeof name === "string" && isInstructionLikeNewsText(name) ? "[Instruction-like company name withheld]" : name);
  for (const entry of Array.isArray(news?.articles) ? news.articles : []) {
    const article = record(entry);
    if (article && typeof article.title === "string" && isInstructionLikeNewsText(article.title))
      article.title = "[Instruction-like headline withheld]";
    for (const originEntry of Array.isArray(article?.origins) ? article.origins : []) {
      const origin = record(originEntry);
      if (origin && typeof origin.publisher === "string" && isInstructionLikeNewsText(origin.publisher))
        origin.publisher = "[Instruction-like publisher withheld]";
      if (origin && typeof origin.providerId === "string" && isInstructionLikeNewsText(origin.providerId))
        origin.providerId = "[Instruction-like provider id withheld]";
    }
  }
  const reading = record(root.reading);
  if (reading) reading.usable = documents.filter(entry => {
    const document = record(entry);
    return (document?.status === "available" || document?.status === "truncated")
      && Array.isArray(document.paragraphs) && document.paragraphs.length > 0;
  }).length;
  view.modelPresentation = { withheldParagraphs: withheld,
    note: "This is a model-facing excerpt. Withheld page paragraphs remain in the original local evidence and content hash, but are not citeable financial claims." };
  return view;
}
