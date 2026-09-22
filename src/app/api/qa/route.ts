import { NextRequest, NextResponse } from "next/server";
import {
    getPullDetail,
    getPullDiff,
    listIssueComments,
    listReviewComments,
    listCheckRunsForRef,
    listCommitStatuses,
} from "@/lib/github";
import { askAboutPull, type QaMessage } from "@/lib/qa";
import { withSessionOverrides, UnauthenticatedError } from "@/lib/session";
import { LlmNotConfiguredError } from "@/lib/llm";

export const runtime = "nodejs";

const DEFAULT_MAX_DIFF = 120_000;

function formatComments(
    issueComments: { user: { login: string } | null; body: string; created_at: string }[],
    reviewComments: { user: { login: string } | null; body: string; path: string; line: number | null; created_at: string }[],
): string {
    const parts: string[] = [];
    for (const c of issueComments) {
        parts.push(`@${c.user?.login ?? "unknown"} (${c.created_at}):\n${c.body}`);
    }
    for (const c of reviewComments) {
        const loc = c.line ? `${c.path}:${c.line}` : c.path;
        parts.push(`@${c.user?.login ?? "unknown"} on ${loc} (${c.created_at}):\n${c.body}`);
    }
    return parts.join("\n\n---\n\n");
}

function formatCiSummary(
    checks: { name: string; status: string; conclusion: string | null }[],
): string {
    if (checks.length === 0) return "";
    const lines = checks.map((c) => {
        const state = c.status === "completed" ? (c.conclusion ?? "unknown") : c.status;
        return `- ${c.name}: ${state}`;
    });
    return lines.join("\n");
}

export async function POST(req: NextRequest) {
    try {
        const body = (await req.json()) as {
            owner?: string;
            repo?: string;
            number?: number;
            question?: string;
            history?: QaMessage[];
            glanceSummary?: string;
            reviewGuide?: string;
            repoRulesContext?: string;
            maxDiffChars?: number;
        };

        const owner = body.owner?.trim();
        const repo = body.repo?.trim();
        const number = body.number;
        const question = body.question?.trim();

        if (!owner || !repo || typeof number !== "number" || !Number.isFinite(number)) {
            return NextResponse.json(
                { error: "owner, repo, and numeric number are required" },
                { status: 400 },
            );
        }

        if (!question) {
            return NextResponse.json({ error: "question is required" }, { status: 400 });
        }

        const maxDiffChars =
            typeof body.maxDiffChars === "number" && body.maxDiffChars > 0
                ? Math.min(body.maxDiffChars, 250_000)
                : DEFAULT_MAX_DIFF;

        const result = await withSessionOverrides(req, async (llmConfig) => {
            const [detail, diff, issueComments, reviewComments] = await Promise.all([
                getPullDetail(owner, repo, number),
                getPullDiff(owner, repo, number),
                listIssueComments(owner, repo, number),
                listReviewComments(owner, repo, number),
            ]);

            const headRepo = detail.head as unknown as {
                sha: string;
                repo?: { owner: { login: string }; name: string } | null;
            };
            const checksOwner = headRepo.repo?.owner?.login ?? owner;
            const checksRepo = headRepo.repo?.name ?? repo;

            const [checkRuns, commitStatuses] = await Promise.all([
                listCheckRunsForRef(checksOwner, checksRepo, headRepo.sha),
                listCommitStatuses(owner, repo, headRepo.sha),
            ]);

            const allChecks = [...checkRuns, ...commitStatuses];
            const comments = formatComments(issueComments, reviewComments);
            const ciSummary = formatCiSummary(allChecks);

            const description = (detail as unknown as { body?: string }).body ?? "";

            return askAboutPull({
                owner,
                repo,
                number,
                title: detail.title,
                description,
                diff,
                comments,
                ciSummary,
                glanceSummary: body.glanceSummary ?? "",
                reviewGuide: body.reviewGuide ?? "",
                repoRulesContext: body.repoRulesContext ?? "",
                question,
                history: body.history ?? [],
                maxDiffChars,
                llmConfig: llmConfig!,
            });
        });

        return NextResponse.json({
            model: result.model,
            answer: result.answer,
        });
    } catch (e) {
        if (e instanceof UnauthenticatedError) {
            return NextResponse.json({ error: e.message }, { status: 401 });
        }
        if (e instanceof LlmNotConfiguredError) {
            return NextResponse.json({ error: e.message }, { status: 422 });
        }
        const message = e instanceof Error ? e.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
