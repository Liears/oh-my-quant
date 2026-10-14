import { expect, test } from "bun:test";
import { auditNewsAnswerCitations } from "../news-citations.ts";

function evidence(text = "It does not report that the condition occurred or that guidance was raised.") {
  return { documents: [{ articleId: "a", requestedUrl: "https://example.test/a", status: "available", contentHash: "a".repeat(64),
    paragraphs: [{ id: "p1", text }, { id: "p2", text: "An unrelated source observation." }] }],
  citations: [{ id: "N-a", articleId: "a", requestedUrl: "https://example.test/a", status: "available", contentHash: "a".repeat(64), paragraphIds: ["p1", "p2"] }] };
}
test.each(["条件并未发生 [N-a/p1] [N-a/p2]", "The condition did not occur. [N-a/p1]", "条件未满足 [N-a/p1,p2]"])("rejects unsupported non-occurrence tied to an unreported condition: %s", answer => {
  expect(auditNewsAnswerCitations(answer, evidence()).violations).toEqual(["unreported-condition-promoted-to-nonoccurrence"]);
});
test.each(["未报告条件发生 [N-a/p1]", "不能断言条件并未发生 [N-a/p1]", "“条件并未发生”是错误表述 [N-a/p1]", "如果条件未满足 [N-a/p1]", "是否条件未满足 [N-a/p1]", "条件并未发生 [N-a/p2]", "条件并未发生。其他信息 [N-a/p1]", "条件并未发生 [N-missing/p1]"])("does not borrow an unrelated paragraph or treat a qualification as a claim: %s", answer => {
  expect(auditNewsAnswerCitations(answer, evidence()).violations).not.toContain("unreported-condition-promoted-to-nonoccurrence");
});
test("a paragraph explicitly confirming absence remains citeable", () => {
  expect(auditNewsAnswerCitations("条件并未发生 [N-a/p1]", evidence("The condition did not occur.")).violations).toEqual([]);
});
