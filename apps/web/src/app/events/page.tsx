import { redirect } from "next/navigation";

/** Events live on calendars; /events itself goes to the united calendar. */
export default function EventsIndex() {
  redirect("/calendar");
}
