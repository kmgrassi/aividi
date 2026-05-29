"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Editor } from "@/components/Editor";

function StudioInner() {
  const params = useSearchParams();
  const goal = params.get("goal") ?? "";
  const length = Number(params.get("length")) || 30;
  return <Editor initialGoal={goal} initialLength={length} />;
}

export default function StudioPage() {
  return (
    <Suspense fallback={null}>
      <StudioInner />
    </Suspense>
  );
}
