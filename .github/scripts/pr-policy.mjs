/** Readable PR requirements; semantic scope and evidence quality remain review duties. */
export function visibleBody(body = "") {
  let fence;
  return body.replace(/<!--[\s\S]*?(?:-->|$)/g, "").split("\n").filter(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
      return false;
    }
    if (marker) { fence = marker[1]; return false; }
    return true;
  }).join("\n").replace(/`[^`\n]*`/g, "");
}

export function primaryIssue(body) {
  const text = visibleBody(body);
  const lines = [...text.matchAll(/^Closes #([1-9]\d*)\s*$/gim)];
  const closing = [...text.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+(?:#\d+|[\w.-]+\/[\w.-]+#\d+|https:\/\/github\.com\/[^\s]+)/gi)];
  if (lines.length !== 1 || closing.length !== 1) {
    throw new Error('Use exactly one standalone "Closes #<issue>" line for a same-repository issue');
  }
  const number = Number(lines[0][1]);
  if (!Number.isSafeInteger(number)) throw new Error("Invalid issue number");
  return number;
}

export function validateDescription(body, files) {
  const issue = primaryIssue(body);
  const text = visibleBody(body);
  const sections = text.split(/^## /m).slice(1);
  for (const section of ["Outcome", "Scope and Documentation", "Acceptance", "Verification", "Visual Evidence", "Risks and Rollback"]) {
    const match = sections.find(part => part.split("\n")[0].trim() === section);
    if (!match?.slice(match.indexOf("\n") + 1).trim() || !match.includes("\n")) {
      throw new Error(`Complete the "${section}" section`);
    }
  }
  if (!files.some(file => file.startsWith("docs/") && file.endsWith(".md"))) {
    throw new Error("Update the relevant current Markdown documentation under docs/");
  }
  return issue;
}

export async function checkPullRequest({ github, owner, repo, number }) {
  const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: number });
  const files = await github.paginate(github.rest.pulls.listFiles, { owner, repo, pull_number: number, per_page: 100 });
  if (files.length !== pr.changed_files) throw new Error("Could not inspect every changed file");
  const issueNumber = validateDescription(pr.body ?? "", files.filter(file => file.status !== "removed").map(file => file.filename));
  const { data: issue } = await github.rest.issues.get({ owner, repo, issue_number: issueNumber });
  if (issue.pull_request || issue.state !== "open") throw new Error("The closing reference must identify an open issue, not a PR");
  const open = await github.paginate(github.rest.pulls.list, { owner, repo, state: "open", per_page: 100 });
  for (const other of open) {
    if (other.number === number) continue;
    let linked;
    try { linked = primaryIssue(other.body ?? ""); } catch { continue; }
    if (linked === issueNumber) throw new Error(`Issue #${issueNumber} already has active PR #${other.number}`);
  }
  return issueNumber;
}
