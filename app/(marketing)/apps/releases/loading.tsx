export default function Loading() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-32" aria-busy="true">
      <p role="status" className="text-text-secondary">
        Loading catalog history…
      </p>
    </main>
  );
}
