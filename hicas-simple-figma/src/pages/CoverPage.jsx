export default function CoverPage() {
  return (
    <main className="cover-page">
      <div className="cover-rings" aria-hidden="true" />
      <img className="cover-logo" src="/HICAS.png" alt="HICAS" />
      <section className="cover-content">
        <p className="cover-kicker">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9.5" />
            <path d="M2.5 12h19M12 2.5c2.7 2.6 4.1 5.8 4.1 9.5S14.7 18.9 12 21.5M12 2.5C9.3 5.1 7.9 8.3 7.9 12s1.4 6.9 4.1 9.5" />
          </svg>
          <span>Web</span>
        </p>
        <h1>Training</h1>
        <p className="cover-date">07/2026</p>
      </section>
    </main>
  );
}
