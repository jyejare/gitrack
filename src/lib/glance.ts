import { callLlm } from "@/lib/llm";

export type WalkthroughEntry = {
    file: string;
    change: string;
    summary: string;
    code?: string;
};

export type GlanceResult = {
    model: string;
    summary: string;
    walkthrough: WalkthroughEntry[];
    markdown?: string;
};

function extractJson<T>(text: string): T | null {
    const trimmed = text.trim();
    try { return JSON.parse(trimmed); } catch { /* not raw JSON */ }
    const match = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (match) {
        try { return JSON.parse(match[1]); } catch { /* bad JSON inside fence */ }
    }
    const braceStart = trimmed.indexOf("{");
    if (braceStart >= 0) {
        let candidate = trimmed.slice(braceStart);
        candidate = candidate.replace(/\s*```\s*$/, "");
        try { return JSON.parse(candidate); } catch { /* try repair */ }
        const lastComplete = Math.max(candidate.lastIndexOf("},"), candidate.lastIndexOf("}]"));
        if (lastComplete > 0) {
            const repaired = candidate.slice(0, lastComplete + 2).replace(/,\s*$/, "") + "]}";
            try { return JSON.parse(repaired); } catch { /* repair failed */ }
        }
    }
    return null;
}

export async function glancePull(input: {
    owner: string;
    repo: string;
    number: number;
    title: string;
    diff: string;
    maxDiffChars: number;
}): Promise<GlanceResult> {
    const truncated =
        input.diff.length > input.maxDiffChars
            ? `${input.diff.slice(0, input.maxDiffChars)}\n\n[DIFF TRUNCATED FOR SIZE]`
            : input.diff;

    const prompt = [
        `You are a staff engineer summarizing a pull request for reviewers, similar to CodeRabbit or Devin AI.`,
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
        `  "summary": "A 2-4 sentence high-level description of what this PR does and why.",`,
        `  "walkthrough": [`,
        `    {`,
        `      "file": "path/to/file.ts",`,
        `      "change": "Modified|Added|Removed|Renamed",`,
        `      "summary": "One sentence describing what changed in this file and why it matters.",`,
        `      "code": "2-5 key lines from the diff showing the most important change, with +/- prefixes preserved"`,
        `    }`,
        `  ]`,
        `}`,
        ``,
        `Rules:`,
        `- Include EVERY file that appears in the diff.`,
        `- Use real file paths from the diff.`,
        `- "change" must be one of: Modified, Added, Removed, Renamed.`,
        `- Keep each file summary to one clear sentence.`,
        `- "code" MUST contain 2-5 actual lines copied from the diff with their +/- prefixes. Pick the most meaningful changed lines for each file. Separate lines with \\n.`,
        `- The overall summary should capture the purpose and impact of the PR.`,
        `- Prioritize logic changes, API changes, security-sensitive code, and error handling. Skip trivial formatting or import changes in the code field.`,
    ].join("\n");

    const { model, text } = await callLlm(prompt, 3000);

    type RawShape = { summary?: string; walkthrough?: WalkthroughEntry[] };
    const parsed = extractJson<RawShape>(text);

    if (parsed?.summary && Array.isArray(parsed.walkthrough)) {
        return {
            model,
            summary: parsed.summary,
            walkthrough: parsed.walkthrough,
        };
    }

    return {
        model,
        summary: "",
        walkthrough: [],
        markdown: text,
    };
}
