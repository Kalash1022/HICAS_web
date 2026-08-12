import { ArrowRight, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../auth/auth-context';
import { useCart } from '../cart/cart-context';
import AuthAlert from '../components/auth/AuthAlert';
import { formatStorefrontPrice } from '../components/storefront/price';
import StorefrontLayout from '../components/storefront/StorefrontLayout';
import StorefrontProductImage from '../components/storefront/StorefrontProductImage';
import { ROUTES, shopProductPath } from '../config/routes';
import { getAuthErrorMessage } from '../lib/api';
import { customerApi } from '../lib/customer-api';

function CartItem({ item, busy, onSetQuantity, onDelete }) {
  const unavailable = !item.product.isPurchasable;

  return (
    <article className="cart-item">
      <Link className="cart-item__image-link" to={shopProductPath(item.product.slug)} aria-label={item.product.name}>
        <StorefrontProductImage className="cart-item__image" image={item.product.primaryImage} name={item.product.name} />
      </Link>
      <div className="cart-item__copy">
        <Link to={shopProductPath(item.product.slug)}>{item.product.name}</Link>
        <span>{formatStorefrontPrice(item.product.price)}</span>
        {unavailable ? <p>Sản phẩm này không còn được mở bán. Hãy xóa khỏi giỏ hàng.</p> : null}
      </div>
      <div className="cart-item__quantity" aria-label={`Số lượng ${item.product.name}`}>
        <button
          type="button"
          aria-label={`Giảm số lượng ${item.product.name}`}
          disabled={busy || unavailable || item.quantity <= 1}
          onClick={() => onSetQuantity(item, item.quantity - 1)}
        >
          <Minus size={15} />
        </button>
        <output>{item.quantity}</output>
        <button
          type="button"
          aria-label={`Tăng số lượng ${item.product.name}`}
          disabled={busy || unavailable}
          onClick={() => onSetQuantity(item, item.quantity + 1)}
        >
          <Plus size={15} />
        </button>
      </div>
      <strong className="cart-item__total">{formatStorefrontPrice(item.lineTotal)}</strong>
      <button className="cart-item__delete" type="button" disabled={busy} onClick={() => onDelete(item)} aria-label={`Xóa ${item.product.name} khỏi giỏ hàng`}>
        <Trash2 size={18} />
      </button>
    </article>
  );
}

export default function CartPage() {
  const { requestWithAuthentication } = useAuth();
  const { cart, error, loading, refreshCart } = useCart();
  const [busyItemId, setBusyItemId] = useState('');
  const [actionError, setActionError] = useState('');

  const runItemAction = async (itemId, action) => {
    setBusyItemId(itemId);
    setActionError('');

    try {
      await action();
      await refreshCart();
    } catch (requestError) {
      setActionError(getAuthErrorMessage(requestError));
      refreshCart().catch(() => undefined);
    } finally {
      setBusyItemId('');
    }
  };

  const handleSetQuantity = (item, quantity) => {
    runItemAction(item.id, () => customerApi.updateCartItem(requestWithAuthentication, item.id, quantity));
  };

  const handleDelete = (item) => {
    runItemAction(item.id, () => customerApi.deleteCartItem(requestWithAuthentication, item.id));
  };

  const displayError = actionError || (error ? getAuthErrorMessage(error) : '');
  const hasUnavailableItem = cart.items.some((item) => !item.product.isPurchasable);

  return (
    <StorefrontLayout title="Giỏ hàng">
      <section className="storefront-container cart-page" aria-busy={loading || Boolean(busyItemId)}>
        <header className="cart-page__heading">
          <div>
            <p className="shop-eyebrow">GIỎ HÀNG</p>
            <h2>Giỏ hàng của bạn</h2>
          </div>
          <Link to={ROUTES.shop}>Tiếp tục mua sắm</Link>
        </header>

        <AuthAlert>{displayError}</AuthAlert>

        {loading && cart.items.length === 0 ? <div className="cart-state" role="status">Đang tải giỏ hàng…</div> : null}
        {!loading && cart.items.length === 0 ? (
          <div className="cart-state">
            <ShoppingBag size={34} aria-hidden="true" />
            <h2>Giỏ hàng đang trống</h2>
            <p>Hãy chọn sản phẩm bạn muốn mua trước khi đặt hàng.</p>
            <Link className="primary-button" to={ROUTES.shop}>Khám phá sản phẩm</Link>
          </div>
        ) : null}

        {cart.items.length > 0 ? (
          <div className="cart-layout">
            <section className="cart-items" aria-label="Sản phẩm trong giỏ hàng">
              {cart.items.map((item) => (
                <CartItem
                  item={item}
                  busy={busyItemId === item.id}
                  onSetQuantity={handleSetQuantity}
                  onDelete={handleDelete}
                  key={item.id}
                />
              ))}
            </section>
            <aside className="cart-summary" aria-label="Tóm tắt giỏ hàng">
              <h2>Tóm tắt đơn hàng</h2>
              <dl>
                <div><dt>Sản phẩm</dt><dd>{cart.itemCount}</dd></div>
                <div><dt>Tạm tính</dt><dd>{formatStorefrontPrice(cart.subtotal)}</dd></div>
                <div className="cart-summary__total"><dt>Tổng tạm tính</dt><dd>{formatStorefrontPrice(cart.subtotal)}</dd></div>
              </dl>
              {hasUnavailableItem ? <p className="cart-summary__warning">Xóa các sản phẩm không còn mở bán trước khi đặt hàng.</p> : null}
              {!hasUnavailableItem ? <Link className="primary-button" to={ROUTES.checkout}>Tiến hành đặt hàng <ArrowRight size={17} /></Link> : null}
              <p className="cart-summary__note">Bạn sẽ chọn địa chỉ giao hàng và xác nhận đơn ở bước tiếp theo.</p>
            </aside>
          </div>
        ) : null}
      </section>
    </StorefrontLayout>
  );
}
