"use server";

import { revalidatePath } from "next/cache";
import { act } from "@/lib/domain/kit";
import * as messaging from "@/lib/domain/messaging";

/*
 * Messages server actions. Sending, editing and read markers don't revalidate:
 * the open thread and list keep their own state and poll for changes, so a
 * full page refresh on every message would only cost time. Group changes do
 * refresh the Messages layout, since the list and header names change.
 */

export async function sendMessageAction(conversationId: string, body: string) {
  return act((actor) => messaging.sendMessage(actor, conversationId, body));
}

export async function editMessageAction(messageId: string, body: string) {
  return act((actor) => messaging.editMessage(actor, messageId, body));
}

export async function deleteMessageAction(messageId: string) {
  return act((actor) => messaging.deleteMessage(actor, messageId));
}

export async function markReadAction(conversationId: string) {
  return act((actor) => messaging.markConversationRead(actor, conversationId));
}

export async function startDirectAction(userId: string) {
  return act((actor) => messaging.startDirectConversation(actor, userId));
}

export async function createGroupAction(input: { title: string; memberIds: string[] }) {
  const r = await act((actor) => messaging.createLeadersGroup(actor, input));
  if (r.ok) revalidatePath("/messages", "layout");
  return r;
}

export async function addGroupMembersAction(conversationId: string, memberIds: string[]) {
  const r = await act((actor) => messaging.addGroupMembers(actor, conversationId, memberIds));
  if (r.ok) revalidatePath("/messages", "layout");
  return r;
}

export async function renameGroupAction(conversationId: string, title: string) {
  const r = await act((actor) => messaging.renameLeadersGroup(actor, conversationId, title));
  if (r.ok) revalidatePath("/messages", "layout");
  return r;
}

export async function leaveGroupAction(conversationId: string) {
  const r = await act((actor) => messaging.leaveLeadersGroup(actor, conversationId));
  if (r.ok) revalidatePath("/messages", "layout");
  return r;
}
