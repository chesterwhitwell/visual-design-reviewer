import Link from "next/link";

export default function NotFound() {
  return (
    <main className="home-main">
      <section className="empty-state">
        <p className="eyebrow">Not found</p>
        <h2>This review is not available</h2>
        <p>It may have been removed, or the address may be incorrect.</p>
        <Link className="button button-primary" href="/">
          Return to reviews
        </Link>
      </section>
    </main>
  );
}
