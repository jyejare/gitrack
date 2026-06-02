import { NextRequest, NextResponse } from "next/server";
import { submitPrReview, getPullDiff, parseDiffValidLines, snapToValidLine } from "@/lib/github";
import { withSessionOverrides } from "@/lib/session";

export const runtime = "nodejs";

type ReviewComment = {
    file: string;
    line?: string;
    severity: string;
    title: string;
    body: string;
    existing_code?: string;
    suggested_code?: string;
};

const SEVERITY_EMOJI: Record<string, string> = {
    critical: "Critical",
    warning: "Warning",
    suggestion: "Suggestion",
    nitpick: "Nitpick",
    praise: "Praise",
};

const VERDICT_TO_EVENT: Record<string, "APPROVE" | "REQUEST_CHANGES" | "COMMENT"> = {
    approve: "APPROVE",
    "request-changes": "REQUEST_CHANGES",
    comment: "COMMENT",
};

function parseLine(raw?: string): { line?: number; start_line?: number } {
    if (!raw) return {};
    const range = raw.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]);
        return start < end ? { line: end, start_line: start } : { line: start };
    }
    const single = Number(raw);
    return Number.isFinite(single) && single > 0 ? { line: single } : {};
}

function formatCommentBody(c: ReviewComment): string {
    const label = SEVERITY_EMOJI[c.severity] ?? "Comment";
    const lines: string[] = [`**[${label}] ${c.title}**`, "", c.body];
    if (c.suggested_code) {
        lines.push("", "**Suggested:**", "```suggestion", c.suggested_code, "```");
    }
    return lines.join("\n");
}

function formatOrphanBody(c: ReviewComment): string {
    const label = SEVERITY_EMOJI[c.severity] ?? "Comment";
    const lines: string[] = [
        `**[${label}] ${c.title}**`,
        `> \`${c.file}\`${c.line ? ` (lines ${c.line})` : ""}`,
        "",
        c.body,
    ];
    if (c.existing_code) {
        lines.push("", "```diff", c.existing_code, "```");
    }
    if (c.suggested_code) {
        lines.push("", "```suggestion", c.suggested_code, "```");
    }
    return lines.join("\n");
}

export async function POST(req: NextRequest) {
    try {
        const body = (await req.json()) as {
            owner?: string;
            repo?: string;
            number?: number;
            summary?: string;
            verdict?: string;
            comments?: ReviewComment[];
        };

        const owner = body.owner?.trim();
        const repo = body.repo?.trim();
        const number = body.number;

        if (!owner || !repo || typeof number !== "number" || !Number.isFinite(number)) {
            return NextResponse.json(
                { error: "owner, repo, and numeric number are required" },
                { status: 400 },
            );
        }

        if (!body.summary || !Array.isArray(body.comments)) {
            return NextResponse.json(
                { error: "summary and comments are required" },
                { status: 400 },
            );
        }

        const event = VERDICT_TO_EVENT[body.verdict ?? "comment"] ?? "COMMENT";
        const comments = body.comments;

        const result = await withSessionOverrides(req, async () => {
            const diff = await getPullDiff(owner, repo, number);
            const validLines = parseDiffValidLines(diff);

            const inlineComments: { path: string; body: string; line: number; start_line?: number }[] = [];
            const orphanedComments: { path: string; body: string }[] = [];

            for (const c of comments) {
                const { line, start_line } = parseLine(c.line);
                const fileLines = validLines.get(c.file);

                if (line && fileLines && fileLines.size > 0) {
                    const snapped = snapToValidLine(line, fileLines);
                    if (snapped) {
                        const entry: { path: string; body: string; line: number; start_line?: number } = {
                            path: c.file,
                            body: formatCommentBody(c),
                            line: snapped,
                        };
                        if (start_line) {
                            const snappedStart = snapToValidLine(start_line, fileLines);
                            if (snappedStart && snappedStart < snapped) {
                                entry.start_line = snappedStart;
                            }
                        }
                        inlineComments.push(entry);
                        continue;
                    }
                }

                orphanedComments.push({ path: c.file, body: formatOrphanBody(c) });
            }

            return submitPrReview(owner, repo, number, {
                event,
                body: body.summary!,
                comments: [...inlineComments, ...orphanedComments],
            });
        });

        return NextResponse.json({
            success: true,
            reviewId: result.id,
            url: result.html_url,
        });
    } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
