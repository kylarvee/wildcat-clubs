import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { majorOptions, settingsUser } from "@/lib/profiles/queries";
import { ProfileForm } from "@/components/profile/settings/ProfileForm";
import { RetiredNotice } from "@/components/profile/settings/RetiredNotice";

export const metadata: Metadata = { title: "Settings · Profile" };

export default async function ProfileSettingsPage() {
  const actor = await requireUser("/settings");
  const [user, majors] = await Promise.all([settingsUser(actor.id), majorOptions()]);
  if (!user) notFound();
  if (user.status === "ALUMNI") return <RetiredNotice handle={user.handle} graduatedAt={user.graduatedAt} />;
  return <ProfileForm user={user} majors={majors} />;
}
