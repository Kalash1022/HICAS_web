export default function BrandLogo({ large = false }) {
  const className = large ? 'brand-logo brand-logo--large' : 'brand-logo';

  return (
    <div className={className} aria-label="HICAS placeholder logo">
      <span>HI</span>
      <span className="brand-mark">CΛS</span>
    </div>
  );
}
