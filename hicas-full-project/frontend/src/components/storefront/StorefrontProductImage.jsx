import { PackageOpen } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function StorefrontProductImage({ image, name, className }) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [image?.url]);

  if (!image?.url || imageFailed) {
    return (
      <div className={`${className} ${className}--placeholder`} aria-label={`Chưa có ảnh cho ${name}`}>
        <PackageOpen size={28} aria-hidden="true" />
      </div>
    );
  }

  return (
    <img
      className={className}
      src={image.url}
      alt={image.altText?.trim() || name}
      onError={() => setImageFailed(true)}
    />
  );
}
