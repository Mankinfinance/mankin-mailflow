import { z } from "zod";

/**
 * What a request to the assistant may contain.
 *
 * Kept out of the route file because Next only allows handlers and
 * segment config to be exported from one, and the limits are worth
 * testing directly.
 */

export const MAX_TURNS = 24;
export const MAX_CHARS = 4000;

export const AssistantRequestSchema = z
  .object({
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().trim().min(1).max(MAX_CHARS),
        }),
      )
      .min(1)
      .max(MAX_TURNS),
    page: z.string().max(200).nullable().optional(),
  })
  /* The API needs a conversation that starts with the person and ends
     with them — anything else is not a question waiting for an answer. */
  .refine((b) => b.messages[0].role === "user", "The first message must be yours.")
  .refine(
    (b) => b.messages[b.messages.length - 1].role === "user",
    "The last message must be yours.",
  );
