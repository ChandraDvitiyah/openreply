import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { SchedulerError } from "./service";
export function schedulerFailure(error: unknown) {
  if (error instanceof ZodError)
    return NextResponse.json(
      {
        success: false,
        error: error.issues[0]?.message ?? "Invalid post",
        issues: error.issues,
      },
      { status: 400 },
    );
  if (error instanceof SchedulerError)
    return NextResponse.json(
      { success: false, error: error.message },
      { status: error.status },
    );
  if (error instanceof SyntaxError)
    return NextResponse.json(
      { success: false, error: "Invalid JSON request." },
      { status: 400 },
    );
  console.error(
    "[Scheduler] Request failed",
    error instanceof Error ? error.name : "unknown",
  );
  return NextResponse.json(
    {
      success: false,
      error: "Unable to save or load posts. Please try again.",
    },
    { status: 500 },
  );
}
