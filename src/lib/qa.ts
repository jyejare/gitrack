import { callLlm, type LlmConfig } from "@/lib/llm";
import {
  estimateTokens,
  truncateToTokens,
  sanitizeForPrompt,
  sanitizePromptSections,
  calculateTokenBudget,
} from "@/lib/model-registry";

export type QaMessage = {
    role: "user" | "assistant";
    content: string;
};

export type QaResult = {
    model: string;
    answer: string;
};

const SYSTEM_PROMPT = `You are a staff engineer answering questions about a GitHub pull request.
Be precise and cite file paths and line numbers from the diff when relevant (format: \`path/to/file.ts:42\`).
If the available context does not contain enough information to answer confidently, say so.`;

const INSTRUCTIONS = `Answer in markdown. Be concise but thorough. Cite \`file:line\` when referencing code.`;

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
    const model = input.llmConfig.model;
    const provider = input.llmConfig.provider;
    const budget = calculateTokenBudget(model, provider, 2048);

    const sanitized = sanitizePromptSections({
        description: input.description,
        diff: input.diff,
        comments: input.comments,
        ciSummary: input.ciSummary,
        glanceSummary: input.glanceSummary,
        reviewGuide: input.reviewGuide,
        repoRulesContext: input.repoRulesContext,
        question: input.question,
    });

    const diffBudget = Math.floor(budget.availableForContext * 0.5);
    const truncatedDiff = truncateToTokens(sanitized.diff, diffBudget);

    const contextSections: string[] = [];

    if (sanitized.description) {
        contextSections.push(`<pr-description>\n${sanitized.description}\n</pr-description>`);
    }

    contextSections.push(`<diff>\n${truncatedDiff}\n</diff>`);

    if (sanitized.comments) {
        contextSections.push(`<discussion-comments>\n${sanitized.comments}\n</discussion-comments>`);
    }

    if (sanitized.ciSummary) {
        contextSections.push(`<ci-checks>\n${sanitized.ciSummary}\n</ci-checks>`);
    }

    if (sanitized.glanceSummary) {
        contextSections.push(`<glance-summary>\n${sanitized.glanceSummary}\n</glance-summary>`);
    }

    if (sanitized.reviewGuide) {
        contextSections.push(`<review-guide>\n${sanitized.reviewGuide}\n</review-guide>`);
    }

    if (sanitized.repoRulesContext) {
        contextSections.push(`<repo-rules>\n${sanitized.repoRulesContext}\n</repo-rules>`);
    }

    const historyBlock = input.history
        .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${sanitizeForPrompt(m.content)}`)
        .join("\n\n");

    const staticPromptParts = [
        SYSTEM_PROMPT,
        "",
        `Repository: ${input.owner}/${input.repo}`,
        `PR #${input.number}: ${sanitizeForPrompt(input.title)}`,
        "",
    ];
    const staticPrompt = staticPromptParts.join("\n");
    const contextBody = contextSections.join("\n");
    const staticTokens = estimateTokens(staticPrompt + INSTRUCTIONS + sanitized.question + contextBody);

    let availableForHistory = budget.availableForContext - staticTokens;
    let usedHistory = historyBlock;

    if (availableForHistory < 500) {
        usedHistory = "";
    } else if (estimateTokens(historyBlock) > availableForHistory) {
        usedHistory = truncateToTokens(historyBlock, availableForHistory);
    }

    const prompt = [
        staticPrompt,
        ...contextSections,
        ...(usedHistory ? ["", `<conversation-history>`, usedHistory, `</conversation-history>`] : []),
        "",
        `User question: ${sanitized.question}`,
        "",
        INSTRUCTIONS,
    ].join("\n");

    const finalPromptTokens = estimateTokens(prompt);
    if (finalPromptTokens > budget.availableForContext) {
        const overflow = finalPromptTokens - budget.availableForContext;
        const reDiffBudget = Math.max(1000, diffBudget - overflow);
        const reTruncatedDiff = reDiffBudget > 1000 ? truncateToTokens(sanitized.diff, reDiffBudget) : "[DIFF OMITTED - CONTEXT TOO LARGE]";

        const rebuiltSections = contextSections.map((s) =>
            s.startsWith("<diff>") ? `<diff>\n${reTruncatedDiff}\n</diff>` : s
        );

        const rebuiltPrompt = [
            staticPrompt,
            ...rebuiltSections,
            ...(usedHistory ? ["", `<conversation-history>`, usedHistory, `</conversation-history>`] : []),
            "",
            `User question: ${sanitized.question}`,
            "",
            INSTRUCTIONS,
        ].join("\n");

        const { model: modelName, text } = await callLlm(rebuiltPrompt, budget.reservedForOutput, input.llmConfig);
        return { model: modelName, answer: text };
    }

    const { model: modelName, text } = await callLlm(prompt, budget.reservedForOutput, input.llmConfig);
    return { model: modelName, answer: text };
}
