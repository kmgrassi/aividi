import { NextRequest, NextResponse } from "next/server";
import { updateGeneratedAssetReview } from "@/lib/store";
import { CharacterConsistencyGrade } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUSES = new Set<CharacterConsistencyGrade>([
  "pass",
  "needs_review",
  "fail",
]);

function parseStatus(value: unknown): CharacterConsistencyGrade {
  const status = String(value || "needs_review");
  if (!STATUSES.has(status as CharacterConsistencyGrade)) {
    throw new Error("Invalid consistency review status.");
  }
  return status as CharacterConsistencyGrade;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { assetId: string } }
) {
  try {
    const body = await req.json();
    const project = await updateGeneratedAssetReview(params.assetId, {
      identity: parseStatus(body.identity),
      wardrobe: parseStatus(body.wardrobe),
      style: parseStatus(body.style),
      temporal: body.temporal ? parseStatus(body.temporal) : undefined,
      notes: String(body.notes || ""),
    });
    return NextResponse.json({ project });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unable to update character review." },
      { status: 400 }
    );
  }
}
