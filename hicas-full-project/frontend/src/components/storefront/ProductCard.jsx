import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { shopProductPath } from '../../config/routes';
import { formatStorefrontPrice } from './price';
import StorefrontProductImage from './StorefrontProductImage';

function hasDiscount(product) {
  return Number(product.compareAtPrice) > Number(product.price);
}

export default function ProductCard({ product }) {
  return (
    <article className="shop-product-card">
      <Link className="shop-product-card__link" to={shopProductPath(product.slug)}>
        <div className="shop-product-card__image-wrap">
          <StorefrontProductImage
            className="shop-product-card__image"
            image={product.primaryImage}
            name={product.name}
          />
        </div>
        <div className="shop-product-card__body">
          <p className="shop-product-card__category">{product.category.name}</p>
          <h2>{product.name}</h2>
          <div className="shop-product-card__prices">
            <strong>{formatStorefrontPrice(product.price)}</strong>
            {hasDiscount(product) ? <s>{formatStorefrontPrice(product.compareAtPrice)}</s> : null}
          </div>
          <span className="shop-product-card__detail">Xem chi tiết <ArrowRight size={16} /></span>
        </div>
      </Link>
    </article>
  );
}
