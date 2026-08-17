export default function Loading() {
  return (
    <main className="home-main" aria-label="Loading">
      <div className="skeleton" style={{ width: 180, height: 14, marginBottom: 20 }} />
      <div className="skeleton" style={{ width: "min(680px, 90%)", height: 62, marginBottom: 20 }} />
      <div className="skeleton" style={{ width: "min(560px, 78%)", height: 20 }} />
    </main>
  );
}
