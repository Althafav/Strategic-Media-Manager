"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="py-24 text-center">
      <h2 className="display text-3xl">Couldn&apos;t reach the media library</h2>
      <p className="text-subtle mt-2">OneDrive may be busy or the share link may have changed.</p>
      <button onClick={reset} className="mt-4 h-9 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium">
        Try again
      </button>
    </div>
  );
}
