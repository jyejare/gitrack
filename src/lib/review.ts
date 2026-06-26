import { callLlm } from "@/lib/llm";

export type ReviewComment = {
    file: string;
    line?: string;
    severity: "critical" | "warning" | "suggestion" | "nitpick" | "praise";
    title: string;
    body: string;
    existing_code?: string;
    suggested_code?: string;
};

export type ReviewResult = {
    model: string;
    summary: string;
    verdict: "approve" | "request-changes" | "comment";
    comments: ReviewComment[];
    markdown?: string;
};

function extractJson<T>(text: string): T | null {
    const trimmed = text.trim();
    try { return JSON.parse(trimmed); } catch { /* not raw JSON */ }
    const match = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (match) {
        try { return JSON.parse(match[1]); } catch { /* bad JSON inside fence */ }
    }
    // Try to find the outermost { ... } and repair truncated JSON
    const braceStart = trimmed.indexOf("{");
    if (braceStart >= 0) {
        let candidate = trimmed.slice(braceStart);
        // Strip trailing markdown fence if present
        candidate = candidate.replace(/\s*```\s*$/, "");
        try { return JSON.parse(candidate); } catch { /* try repair */ }
        // Attempt repair: drop the last partial entry and close the structure
        const lastComplete = Math.max(candidate.lastIndexOf("},"), candidate.lastIndexOf("}]"));
        if (lastComplete > 0) {
            const repaired = candidate.slice(0, lastComplete + 2).replace(/,\s*$/, "") + "]}";
            try { return JSON.parse(repaired); } catch { /* repair failed */ }
        }
    }
    return null;
}

const VALID_SEVERITIES = new Set(["critical", "warning", "suggestion", "nitpick", "praise"]);
const VALID_VERDICTS = new Set(["approve", "request-changes", "comment"]);

export async function reviewPull(input: {
    owner: string;
    repo: string;
    number: number;
    title: string;
    diff: string;
    maxDiffChars: number;
    customPrompt?: string;
    repoRulesContext?: string;
}): Promise<ReviewResult> {
    const truncated =
        input.diff.length > input.maxDiffChars
            ? `${input.diff.slice(0, input.maxDiffChars)}\n\n[DIFF TRUNCATED FOR SIZE]`
            : input.diff;

    const prompt = [
        `You are a staff engineer performing a thorough code review, similar to CodeRabbit or Devin AI.`,
        ``,
        `Repository: ${input.owner}/${input.repo}`,
        `PR #${input.number}: ${input.title}`,
        ``,
        `<diff>`,
        truncated,
        `</diff>`,
        ``,
        `Respond with ONLY a JSON object (no markdown fences, no extra text) in this exact shape:`,
        `{`,
        `  "summary": "2-4 sentence overall assessment of the PR quality, purpose, and impact.",`,
        `  "verdict": "approve|request-changes|comment",`,
        `  "comments": [`,
        `    {`,
        `      "file": "path/to/file.ts",`,
        `      "line": "42-45",`,
        `      "severity": "critical|warning|suggestion|nitpick|praise",`,
        `      "title": "Short descriptive title for this comment",`,
        `      "body": "Detailed explanation of the issue, why it matters, and how to fix it.",`,
        `      "existing_code": "the current code from the diff that you are commenting on (2-6 lines, preserve +/- prefixes)",`,
        `      "suggested_code": "your suggested replacement code (only if you have a concrete fix or improvement)"`,
        `    }`,
        `  ]`,
        `}`,
        ``,
        `Rules:`,
        `- severity meanings:`,
        `  - critical: bugs, security issues, data loss risks — must fix before merge`,
        `  - warning: potential problems, performance concerns, error handling gaps`,
        `  - suggestion: improvements to readability, maintainability, best practices`,
        `  - nitpick: minor style, naming, or formatting preferences`,
        `  - praise: good patterns, clever solutions, well-written code worth calling out`,
        `- Include 5-15 comments covering the most important observations.`,
        `- Use real file paths and line numbers from the diff.`,
        `- Each comment body should be concrete and actionable.`,
        `- "existing_code" is REQUIRED for every comment — always show the relevant code lines from the diff (with +/- prefixes). Use \\n for line breaks.`,
        `- "suggested_code" should be provided whenever you have a concrete fix or improvement. For praise comments, omit it. Use \\n for line breaks.`,
        `- Include at least one praise comment if there is something genuinely well done.`,
        `- verdict: use "approve" if no critical/warning issues, "request-changes" if critical issues exist, "comment" otherwise.`,
        ...(input.repoRulesContext
            ? [
                ``,
                `The repository contains the following coding rules and conventions (.cursor/rules, .claude).`,
                `You MUST enforce these rules during review — flag violations as warnings or suggestions:`,
                `<repo-rules>`,
                input.repoRulesContext,
                `</repo-rules>`,
            ]
            : []),
        ...(input.customPrompt
            ? [
                ``,
                `Additional review rules provided by the user (apply these alongside the rules above):`,
                input.customPrompt,
            ]
            : []),
    ].join("\n");

    const { model, text } = await callLlm(prompt, 8192);

    type RawShape = {
        summary?: string;
        verdict?: string;
        comments?: ReviewComment[];
    };
    const parsed = extractJson<RawShape>(text);

    if (parsed?.summary && Array.isArray(parsed.comments)) {
        const comments = parsed.comments.map((c) => ({
            ...c,
            severity: VALID_SEVERITIES.has(c.severity) ? c.severity : "suggestion" as const,
        }));
        const verdict = VALID_VERDICTS.has(parsed.verdict ?? "")
            ? (parsed.verdict as ReviewResult["verdict"])
            : "comment";

        return { model, summary: parsed.summary, verdict, comments };
    }

    return {
        model,
        summary: "",
        verdict: "comment",
        comments: [],
        markdown: text,
    };
}
