import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { isAdmin } from "@/lib/auth";
import { AddEventForm } from "./add-event-form";

export const metadata = { title: "Add event · Strategic Media Manager" };

export const maxDuration = 300; // the new event's first index sync runs after the response

export default async function NewEventPage() {
  if (!(await isAdmin())) notFound();
  return (
    <div className="max-w-xl pt-6">
      <Link href="/" className="text-sm text-subtle hover:text-foreground inline-flex items-center gap-1">
        <ChevronLeft className="size-4" /> Events
      </Link>
      <h1 className="display text-5xl mt-4">Add event</h1>
      <p className="text-subtle mt-2 mb-8 max-w-prose">
        Point to the OneDrive folder that holds the event&apos;s media. Files stay in OneDrive; the app reads them through
        the share link.
      </p>
      <AddEventForm />
    </div>
  );
}
