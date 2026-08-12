import { ArrowLeft, ShieldCheck, ShoppingCart } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { useCart } from '../cart/cart-context';
import AuthAlert from '../components/auth/AuthAlert';
import { formatStorefrontPrice } from '../components/storefront/price';
import StorefrontLayout from '../components/storefront/StorefrontLayout';
import StorefrontProductImage from '../components/storefront/StorefrontProductImage';
import { ROUTES } from '../config/routes';
import { getAuthErrorMessage } from '../lib/api';
import { customerApi } from '../lib/customer-api';
import { storefrontApi } from '../lib/storefront-api';

function hasDiscount(product) {
  return Number(product.compareAtPrice) > Number(product.price);
}

export default function ShopProductDetailPage() {
  const { slug } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { status, requestWithAuthentication } = useAuth();
  const { refreshCart } = useCart();
  const [product, setProduct] = useState(null);
  const [selectedImageId, setSelectedImageId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [requestVersion, setRequestVersion] = useState(0);
  const [addingToCart, setAddingToCart] = useState(false);
  const [cartMessage, setCartMessage] = useState('');
  const [cartError, setCartError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    setLoading(true);
    setError('');
    setProduct(null);
    setSelectedImageId('');

    storefrontApi.getProduct(slug, { signal: controller.signal })
      .then((result) => {
        if (!isCurrent) {
          return;
        }

        setProduct(result);
        setSelectedImageId(result.images.find((image) => image.isPrimary)?.id || result.images[0]?.id || '');
      })
      .catch((requestError) => {
        if (isCurrent && requestError?.name !== 'AbortError') {
          setError(getAuthErrorMessage(requestError));
        }
      })
      .finally(() => {
        if (isCurrent) {
          setLoading(false);
        }
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [requestVersion, slug]);

  const selectedImage = product?.images.find((image) => image.id === selectedImageId)
    || product?.images.find((image) => image.isPrimary)
    || product?.images[0]
    || null;

  const addToCart = async () => {
    if (!product || addingToCart) {
      return;
    }

    const returnTo = location.pathname + location.search + location.hash;
    if (status === 'mfa-required') {
      navigate(ROUTES.mfa, { state: { returnTo } });
      return;
    }
    if (status !== 'authenticated') {
      navigate(ROUTES.login, { state: { returnTo } });
      return;
    }

    setAddingToCart(true);
    setCartError('');
    setCartMessage('');

    try {
      await customerApi.addCartItem(requestWithAuthentication, { productId: product.id, quantity: 1 });
      await refreshCart();
      setCartMessage('Đã thêm sản phẩm vào giỏ hàng.');
    } catch (requestError) {
      setCartError(getAuthErrorMessage(requestError));
    } finally {
      setAddingToCart(false);
    }
  };

  return (
    <StorefrontLayout title="Chi tiết sản phẩm">
      <section className="storefront-container shop-detail">
        <Link className="shop-back-link" to={ROUTES.shop}><ArrowLeft size={17} /> Quay lại cửa hàng</Link>

        {loading ? <div className="shop-detail-state" role="status">Đang tải sản phẩm…</div> : null}
        {!loading && error ? (
          <div className="shop-detail-state">
            <AuthAlert>{error}</AuthAlert>
            <button className="secondary-button" type="button" onClick={() => setRequestVersion((version) => version + 1)}>Thử lại</button>
          </div>
        ) : null}

        {product ? (
          <article className="shop-detail-card">
            <section className="shop-detail-gallery" aria-label={`Ảnh của ${product.name}`}>
              <div className="shop-detail-main-image">
                <StorefrontProductImage className="shop-detail-main-image__image" image={selectedImage} name={product.name} />
              </div>
              {product.images.length > 1 ? (
                <div className="shop-detail-thumbnails" aria-label="Chọn ảnh sản phẩm">
                  {product.images.map((image, index) => (
                    <button
                      className={image.id === selectedImage?.id ? 'active' : ''}
                      type="button"
                      aria-label={`Xem ảnh ${index + 1} của ${product.name}`}
                      aria-pressed={image.id === selectedImage?.id}
                      onClick={() => setSelectedImageId(image.id)}
                      key={image.id}
                    >
                      <img src={image.url} alt={image.altText?.trim() || `${product.name} — ảnh ${index + 1}`} />
                    </button>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="shop-detail-copy">
              <p className="shop-eyebrow">{product.category.name}</p>
              <h2>{product.name}</h2>
              <div className="shop-detail-prices">
                <strong>{formatStorefrontPrice(product.price)}</strong>
                {hasDiscount(product) ? <s>{formatStorefrontPrice(product.compareAtPrice)}</s> : null}
              </div>
              <div className="shop-detail-description">
                <h2>Mô tả sản phẩm</h2>
                <p>{product.description || 'Thông tin chi tiết về sản phẩm đang được cập nhật.'}</p>
              </div>
              <div className="shop-order-notice">
                <ShieldCheck size={21} aria-hidden="true" />
                <div>
                  <strong>Giá và khả dụng được xác nhận khi đặt hàng</strong>
                  <p>Sản phẩm sẽ được đồng bộ vào giỏ hàng của tài khoản sau khi bạn thêm.</p>
                </div>
              </div>
              <div className="shop-add-to-cart">
                <button className="primary-button" type="button" disabled={addingToCart || status === 'restoring'} onClick={addToCart}>
                  <ShoppingCart size={18} />
                  {addingToCart ? 'Đang thêm…' : status === 'restoring' ? 'Đang kiểm tra phiên…' : status === 'authenticated' ? 'Thêm vào giỏ hàng' : 'Đăng nhập để thêm giỏ'}
                </button>
                {cartMessage ? <p className="form-success" role="status">{cartMessage} <Link to={ROUTES.cart}>Xem giỏ hàng</Link></p> : null}
                <AuthAlert>{cartError}</AuthAlert>
              </div>
            </section>
          </article>
        ) : null}
      </section>
    </StorefrontLayout>
  );
}
