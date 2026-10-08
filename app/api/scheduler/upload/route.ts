import { z } from "zod";
import { NextResponse } from "next/server";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { postKinds, supportedKinds } from "@/lib/scheduler/capabilities";
import { validateUpload } from "@/lib/scheduler/media-files";
import {
  createSchedulerUpload,
  schedulerStorageConfigured,
  StorageError,
} from "@/lib/scheduler/storage";
export const runtime = "nodejs";
const input = z
  .object({
    platform: z.enum(["INSTAGRAM", "FACEBOOK"]),
    kind: z.enum(postKinds),
    contentType: z.string().max(100),
    size: z
      .number()
      .int()
      .positive()
      .max(1024 ** 3),
  })
  .strict();
const response = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function POST(request: Request) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return response({ error: "Sign in to upload files." }, 401);
  if (!schedulerStorageConfigured())
    return response(
      {
        error:
          "Backblaze file uploads are not configured. Use a public HTTPS media URL.",
      },
      503,
    );
  let data: z.infer<typeof input>;
  try {
    data = input.parse(await request.json());
    if (
      data.kind === "TEXT" ||
      !supportedKinds(data.platform).includes(data.kind)
    )
      throw new Error("Choose a supported media post type.");
    validateUpload(
      { type: data.contentType, size: data.size },
      data.platform,
      data.kind,
    );
  } catch (error) {
    return response(
      {
        error:
          error instanceof z.ZodError || error instanceof SyntaxError
            ? "Choose a supported image or video with valid upload details."
            : error instanceof Error
              ? error.message
              : "Invalid upload.",
      },
      400,
    );
  }
  try {
    return response(
      await createSchedulerUpload(
        context.workspaceId,
        data.contentType,
        data.size,
      ),
    );
  } catch (error) {
    return response(
      {
        error:
          error instanceof StorageError
            ? error.message
            : "Unable to prepare the Backblaze upload. Please try again.",
      },
      503,
    );
  }
}
