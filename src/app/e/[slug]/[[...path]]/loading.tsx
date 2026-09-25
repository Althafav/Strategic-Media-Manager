export default function Loading() {
  return (
    <div className="pt-5 animate-pulse motion-reduce:animate-none">
      <div className="h-4 w-48 rounded-sm bg-muted" />
      <div className="h-11 w-80 rounded-sm bg-muted mt-4" />
      <div className="grid gap-[2px] grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] mt-14">
        {Array.from({ length: 24 }, (_, i) => (
          <div key={i} className="aspect-square bg-muted" />
        ))}
      </div>
    </div>
  );
}
