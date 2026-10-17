/** Download presets only: upstream owns each skill's workflow and dependencies. */
export const CURATED_SKILL_REPOSITORIES = [
  { repo: "LLMQuant/skills", revision: "1918237467c2dff4cc97a18ebc0892dfd46e8129",
    skills: ["llmquant-data", "llmquant-macro", "llmquant-equities", "llmquant-portfolio", "llmquant-risk"].map(name => ({ name })) },
  { repo: "tradermonty/claude-trading-skills", revision: "a2506fd1bab662723fb7142734320fef23fc48fa",
    skills: ["market-breadth-analyzer", "technical-analyst", "position-sizer", "macro-regime-detector", "market-environment-analysis"].map(name => ({ name })) },
] as const;

export function curatedSkillRepository(repo: string) {
  return CURATED_SKILL_REPOSITORIES.find(entry => entry.repo.toLowerCase() === repo.toLowerCase());
}
