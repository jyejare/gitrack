import { callLlm, type LlmConfig } from "@/lib/llm";

export type QaMessage = {
    role: "user" | "assistant";
    content: string;
};

export type QaResult = {
    model: string;
    answer: string;
};

export async function askAboutPull(input: {
    owner: string;
    repo: string;
    number: number;
    title: string;
    description: string;
    diff: string;
    comments: string;
    ciSummary: string;
    glanceSummary: string;
    reviewGuide: string;
    repoRulesContext: string;
    question: string;
    history: QaMessage[];
    maxDiffChars: number;
    llmConfig: LlmConfig;
}): Promise<QaResult> {
    const truncatedDiff =
        input.diff.length > input.maxDiffChars
            ? `${input.diff.slice(0, input.maxDiffChars)}\n\n[DIFF TRUNCATED FOR SIZE]`
            : input.diff;

    const contextSections: string[] = [];

    if (input.description) {
        contextSections.push(`<pr-description>\n${input.description}\n</pr-description>`);
    }

    contextSections.push(`<diff>\n${truncatedDiff}\n</diff>`);

    if (input.comments) {
        contextSections.push(`<discussion-comments>\n${input.comments}\n</discussion-comments>`);
    }

    if (input.ciSummary) {
        contextSections.push(`<ci-checks>\n${input.ciSummary}\n</ci-checks>`);
    }

    if (input.glanceSummary) {
        contextSections.push(`<glance-summary>\n${input.glanceSummary}\n</glance-summary>`);
    }

    if (input.reviewGuide) {
        contextSections.push(`<review-guide>\n${input.reviewGuide}\n</review-guide>`);
    }

    if (input.repoRulesContext) {
        contextSections.push(`<repo-rules>\n${input.repoRulesContext}\n</repo-rules>`);
    }

    const historyBlock = input.history
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
        .join("\n\n");

    const prompt = [
        `You are a staff engineer answering questions about a GitHub pull request.`,
        `Be precise and cite file paths and line numbers from the diff when relevant (format: \`path/to/file.ts:42\`).`,
        `If the available context does not contain enough information to answer confidently, say so.`,
        ``,
        `Repository: ${input.owner}/${input.repo}`,
        `PR #${input.number}: ${input.title}`,
        ``,
        ...contextSections,
        ...(historyBlock ? [``, `<conversation-history>`, historyBlock, `</conversation-history>`] : []),
        ``,
        `User question: ${input.question}`,
        ``,
        `Answer in markdown. Be concise but thorough. Cite \`file:line\` when referencing code.`,
    ].join("\n");

    const { model, text } = await callLlm(prompt, 2048, input.llmConfig);
    return { model, answer: text };
}
