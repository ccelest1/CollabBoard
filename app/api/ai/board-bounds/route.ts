import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBoardState } from "@/lib/ai/boardState";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const boardId = searchParams.get("boardId")?.trim();
  const objectIds = (searchParams.get("objectIds") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!boardId) {
    return NextResponse.json({ error: "Missing boardId" }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    const state = await getBoardState(supabase, boardId);
    const objects = state.objects;
    const targets =
      objectIds.length > 0
        ? objects.filter((object) => objectIds.includes(object.id))
        : objects;
    if (targets.length === 0) {
      return NextResponse.json({ bounds: null });
    }

    const minX = Math.min(...targets.map((object) => object.x ?? 0));
    const minY = Math.min(...targets.map((object) => object.y ?? 0));
    const maxX = Math.max(...targets.map((object) => (object.x ?? 0) + (object.width ?? 150)));
    const maxY = Math.max(...targets.map((object) => (object.y ?? 0) + (object.height ?? 150)));
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const centerX = minX + width / 2;
    const centerY = minY + height / 2;

    return NextResponse.json({
      bounds: {
        minX,
        minY,
        maxX,
        maxY,
        centerX,
        centerY,
        x: minX,
        y: minY,
        width,
        height,
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to compute board bounds" }, { status: 500 });
  }
}
