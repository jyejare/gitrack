import { callLlm } from "@/lib/llm";

export async function glancePull(input: {
    owner: string;
    repo: string;
    number: number;
    title: string;
    diff: string;
    maxDiffChars: number;
}) {
    const truncated =
        input.diff.length > input.maxDiffChars
            ? `${input.diff.slice(0, input.maxDiffChars)}\n\n[DIFF TRUNCATED FOR SIZE]`
            : input.diff;

    const prompt = [
        `You are a staff engineer. A reviewer needs to quickly understand the most important code changes in this PR.`,
        ``,
        `Repository: ${input.owner}/${input.repo}`,
        `PR #${input.number}: ${input.title}`,
        ``,
        `<diff>`,
        truncated,
        `</diff>`,
        ``,
        `TASK: Read the diff above carefully. Pick the 3-7 most important changed code areas that a reviewer should focus on. For each area, write:`,
        `- A markdown ### heading with the real file path and real line numbers from the diff`,
        `- One sentence explaining what changed and why it matters`,
        `- A short code snippet (2-5 lines) copied directly from the diff, with the +/- prefixes preserved`,
        ``,
        `IMPORTANT: You MUST use the actual file paths, actual line numbers, and actual code from the diff above. Do NOT use placeholder text.`,
        ``,
        `Prioritize logic changes, API changes, security-sensitive code, and error handling. Skip trivial formatting or import changes.`,
        ``,
        `Start your response directly with the first ### heading. No preamble.`,
    ].join("\n");

    const { model, text } = await callLlm(prompt, 2400);
    return { model, markdown: text };
}
