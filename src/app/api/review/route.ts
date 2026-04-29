import { NextRequest, NextResponse } from "next/server";
import { reviewPullWithClaude } from "@/lib/anthropic";
import { reviewPullWithGroq } from "@/lib/groq";
import { getPullDetail, getPullDiff } from "@/lib/github";
import { getLlmProvider } from "@/lib/llm";

export const runtime = "nodejs";

const DEFAULT_MAX_DIFF = 140_000;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      owner?: string;
      repo?: string;
      number?: number;
      maxDiffChars?: number;
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

    const maxDiffChars =
      typeof body.maxDiffChars === "number" && body.maxDiffChars > 0
        ? Math.min(body.maxDiffChars, 250_000)
        : DEFAULT_MAX_DIFF;

    const detail = await getPullDetail(owner, repo, number);
    const diff = await getPullDiff(owner, repo, number);

    const provider = getLlmProvider();
    const result =
      provider === "groq"
        ? await reviewPullWithGroq({
            owner,
            repo,
            number,
            title: detail.title,
            diff,
            maxDiffChars,
          })
        : await reviewPullWithClaude({
            owner,
            repo,
            number,
            title: detail.title,
            diff,
            maxDiffChars,
          });

    return NextResponse.json({
      number,
      title: detail.title,
      model: result.model,
      markdown: result.markdown,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
