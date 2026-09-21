"use server";

import { revalidatePath } from "next/cache";
import { currentBroker } from "@/lib/auth/current-broker";
import { canAccessAdmin } from "@/lib/auth/permissions";
import { repos } from "@/lib/db/repos";
import { auditLog } from "@/lib/audit";

/**
 * Managing files already uploaded. The upload itself is a route
 * handler — see app/api/files/upload — because a server action's body
 * limit is well under 2 MB.
 */

export async function setAltTextAction(
  id: string,
  altText: string,
): Promise<void> {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) return;

  await repos().media.update(id, { altText: altText.trim().slice(0, 300) });
  revalidatePath("/marketing/files");
}

export async function deleteFileAction(id: string): Promise<void> {
  const broker = await currentBroker();
  if (!(await canAccessAdmin(broker.id))) return;

  const file = await repos().media.get(id);
  if (!file) return;

  await repos().media.remove(id);

  /* Worth an audit line: deleting a file breaks the image in every
     campaign already sent that used it, and those are in inboxes we
     cannot reach. The UI warns; this records who accepted it. */
  await auditLog({
    actor: { type: "broker", id: broker.id },
    action: "media.delete",
    meta: { fileId: id, name: file.name, size: file.size },
  });
  revalidatePath("/marketing/files");
}
