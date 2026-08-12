import BrandLogo from '../components/common/BrandLogo';

export default function CoverPage() {
  return (
    <main className="cover-page">
      <div className="cover-rings" aria-hidden="true"><i /><i /><i /></div>
      <div className="cover-type"><span className="globe">◎</span><span>Web</span></div>
      <div className="cover-copy"><h1>Training</h1><p>07/2026</p></div>
      <div className="cover-logo"><BrandLogo large /></div>
    </main>
  );
}
