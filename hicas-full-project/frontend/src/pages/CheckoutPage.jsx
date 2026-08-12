import { CheckCircle2, MapPin, Plus, ShoppingBag } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { useCart } from '../cart/cart-context';
import AuthAlert from '../components/auth/AuthAlert';
import { formatStorefrontPrice } from '../components/storefront/price';
import CheckoutAddressForm from '../components/storefront/CheckoutAddressForm';
import StorefrontLayout from '../components/storefront/StorefrontLayout';
import { ROUTES } from '../config/routes';
import { getAuthErrorMessage } from '../lib/api';
import { customerApi } from '../lib/customer-api';

function createIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `checkout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function formatAddress(address) {
  return [address.street, address.ward, address.district, address.province]
    .filter(Boolean)
    .join(', ');
}

export default function CheckoutPage() {
  const { requestWithAuthentication } = useAuth();
  const { cart, loading: cartLoading, error: cartError, refreshCart } = useCart();
  const [addresses, setAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [addressesLoading, setAddressesLoading] = useState(true);
  const [addressError, setAddressError] = useState('');
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [addressBusy, setAddressBusy] = useState(false);
  const [customerNote, setCustomerNote] = useState('');
  const [checkoutKey, setCheckoutKey] = useState(createIdempotencyKey);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [completedOrder, setCompletedOrder] = useState(null);

  const loadAddresses = useCallback(async () => {
    setAddressesLoading(true);
    setAddressError('');

    try {
      const result = await customerApi.listAddresses(requestWithAuthentication);
      setAddresses(result);
      setSelectedAddressId((currentAddressId) => (
        result.some((address) => address.id === currentAddressId)
          ? currentAddressId
          : result.find((address) => address.isDefault)?.id || result[0]?.id || ''
      ));
      return result;
    } catch (requestError) {
      setAddresses([]);
      setAddressError(getAuthErrorMessage(requestError));
      throw requestError;
    } finally {
      setAddressesLoading(false);
    }
  }, [requestWithAuthentication]);

  useEffect(() => {
    refreshCart().catch(() => undefined);
    loadAddresses().catch(() => undefined);
  }, [loadAddresses, refreshCart]);

  const rotateCheckoutKey = () => setCheckoutKey(createIdempotencyKey());
  const hasUnavailableItem = cart.items.some((item) => !item.product.isPurchasable);

  const createAddress = async (address) => {
    setAddressBusy(true);
    setAddressError('');

    try {
      const created = await customerApi.createAddress(requestWithAuthentication, address);
      await loadAddresses();
      setSelectedAddressId(created.id);
      setShowAddressForm(false);
      rotateCheckoutKey();
    } catch (requestError) {
      setAddressError(getAuthErrorMessage(requestError));
    } finally {
      setAddressBusy(false);
    }
  };

  const checkout = async () => {
    if (checkoutBusy || !selectedAddressId || cart.items.length === 0 || hasUnavailableItem) {
      return;
    }

    setCheckoutBusy(true);
    setCheckoutError('');

    try {
      const order = await customerApi.checkout(requestWithAuthentication, {
        addressId: selectedAddressId,
        items: cart.items.map((item) => ({ productId: item.product.id, quantity: item.quantity })),
        ...(customerNote.trim() ? { customerNote: customerNote.trim() } : {}),
      }, checkoutKey);
      setCompletedOrder(order);
      setCheckoutKey(createIdempotencyKey());
      await refreshCart();
    } catch (requestError) {
      setCheckoutError(getAuthErrorMessage(requestError));
      if (['CART_ITEM_NOT_FOUND', 'CART_ITEM_QUANTITY_CONFLICT', 'PRODUCT_OUT_OF_STOCK'].includes(requestError?.code)) {
        refreshCart().catch(() => undefined);
      }
      if (requestError?.code === 'ADDRESS_NOT_FOUND' || requestError?.code === 'ADDRESS_DEFAULT_CONFLICT') {
        loadAddresses().catch(() => undefined);
      }
    } finally {
      setCheckoutBusy(false);
    }
  };

  if (completedOrder) {
    return (
      <StorefrontLayout title="Đặt hàng thành công">
        <section className="storefront-container checkout-success">
          <CheckCircle2 size={48} aria-hidden="true" />
          <p className="shop-eyebrow">ĐẶT HÀNG THÀNH CÔNG</p>
          <h2>Cảm ơn bạn đã đặt hàng</h2>
          <p>Đơn hàng <strong>{completedOrder.orderNumber}</strong> đã được tạo và đang chờ xác nhận.</p>
          <dl>
            <div><dt>Tạm tính</dt><dd>{formatStorefrontPrice(completedOrder.subtotal)}</dd></div>
            <div><dt>Phí giao hàng</dt><dd>{formatStorefrontPrice(completedOrder.shippingFee)}</dd></div>
            <div className="checkout-success__total"><dt>Tổng cộng</dt><dd>{formatStorefrontPrice(completedOrder.totalAmount)}</dd></div>
          </dl>
          <div className="checkout-success__actions">
            <Link className="secondary-button" to={ROUTES.myOrders}>Đơn mua của tôi</Link>
            <Link className="primary-button" to={ROUTES.shop}>Tiếp tục mua sắm</Link>
          </div>
        </section>
      </StorefrontLayout>
    );
  }

  return (
    <StorefrontLayout title="Xác nhận đặt hàng">
      <section className="storefront-container checkout-page" aria-busy={cartLoading || addressesLoading || checkoutBusy}>
        <header className="checkout-page__heading">
          <div>
            <p className="shop-eyebrow">THANH TOÁN</p>
            <h2>Xác nhận đặt hàng</h2>
          </div>
          <Link to={ROUTES.cart}>Quay lại giỏ hàng</Link>
        </header>

        <AuthAlert>{checkoutError || addressError || (cartError ? getAuthErrorMessage(cartError) : '')}</AuthAlert>

        {!cartLoading && cart.items.length === 0 ? (
          <div className="cart-state">
            <ShoppingBag size={34} aria-hidden="true" />
            <h2>Giỏ hàng đang trống</h2>
            <p>Hãy thêm sản phẩm vào giỏ trước khi đặt hàng.</p>
            <Link className="primary-button" to={ROUTES.shop}>Khám phá sản phẩm</Link>
          </div>
        ) : null}

        {cart.items.length > 0 ? (
          <div className="checkout-layout">
            <div className="checkout-main">
              <section className="checkout-section" aria-labelledby="checkout-address-heading">
                <div className="checkout-section__heading">
                  <div>
                    <p className="shop-eyebrow">GIAO HÀNG</p>
                    <h2 id="checkout-address-heading">Địa chỉ nhận hàng</h2>
                  </div>
                  <button className="checkout-add-address" type="button" disabled={addressBusy} onClick={() => setShowAddressForm((visible) => !visible)}>
                    <Plus size={17} /> {showAddressForm ? 'Đóng biểu mẫu' : 'Thêm địa chỉ'}
                  </button>
                </div>

                {showAddressForm ? <CheckoutAddressForm busy={addressBusy} onSubmit={createAddress} /> : null}
                {addressesLoading ? <p className="checkout-muted">Đang tải địa chỉ…</p> : null}
                {!addressesLoading && addresses.length === 0 && !showAddressForm ? (
                  <div className="checkout-empty-address">
                    <MapPin size={22} aria-hidden="true" />
                    <p>Thêm địa chỉ giao hàng để tiếp tục.</p>
                  </div>
                ) : null}
                {addresses.length > 0 ? (
                  <div className="checkout-address-list">
                    {addresses.map((address) => (
                      <label className={address.id === selectedAddressId ? 'checkout-address active' : 'checkout-address'} key={address.id}>
                        <input
                          type="radio"
                          name="checkout-address"
                          value={address.id}
                          checked={address.id === selectedAddressId}
                          onChange={() => {
                            setSelectedAddressId(address.id);
                            rotateCheckoutKey();
                          }}
                          disabled={checkoutBusy}
                        />
                        <span>
                          <strong>{address.recipientName} {address.isDefault ? <em>Mặc định</em> : null}</strong>
                          <small>{address.phone}</small>
                          <small>{formatAddress(address)}</small>
                          {address.postalCode ? <small>Mã bưu chính: {address.postalCode}</small> : null}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="checkout-section" aria-labelledby="checkout-note-heading">
                <div className="checkout-section__heading">
                  <div>
                    <p className="shop-eyebrow">GHI CHÚ</p>
                    <h2 id="checkout-note-heading">Ghi chú cho đơn hàng</h2>
                  </div>
                </div>
                <textarea
                  className="checkout-note"
                  value={customerNote}
                  onChange={(event) => {
                    setCustomerNote(event.target.value);
                    rotateCheckoutKey();
                  }}
                  maxLength="1000"
                  placeholder="Ví dụ: gọi trước khi giao hàng"
                  disabled={checkoutBusy}
                />
              </section>
            </div>

            <aside className="checkout-summary" aria-label="Tóm tắt thanh toán">
              <h2>Đơn hàng</h2>
              <div className="checkout-summary__items">
                {cart.items.map((item) => <div key={item.id}><span>{item.product.name} × {item.quantity}</span><strong>{formatStorefrontPrice(item.lineTotal)}</strong></div>)}
              </div>
              <dl>
                <div><dt>Tạm tính</dt><dd>{formatStorefrontPrice(cart.subtotal)}</dd></div>
                <div><dt>Phí giao hàng</dt><dd>Xác nhận khi đặt hàng</dd></div>
              </dl>
              {hasUnavailableItem ? <p className="cart-summary__warning">Giỏ hàng có sản phẩm không còn mở bán. Hãy quay lại giỏ hàng để xử lý.</p> : null}
              <button
                className="primary-button"
                type="button"
                disabled={checkoutBusy || addressesLoading || !selectedAddressId || hasUnavailableItem}
                onClick={checkout}
              >
                {checkoutBusy ? 'Đang tạo đơn hàng…' : 'Đặt hàng (COD)'}
              </button>
              <p>Nhấn đặt hàng để xác nhận đơn thanh toán khi nhận hàng. Giá, phí giao và tồn kho sẽ được kiểm tra lại bởi hệ thống.</p>
            </aside>
          </div>
        ) : null}
      </section>
    </StorefrontLayout>
  );
}
