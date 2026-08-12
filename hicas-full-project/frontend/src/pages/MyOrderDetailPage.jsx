import { ArrowLeft, PackageCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import AuthAlert from '../components/auth/AuthAlert';
import StatusBadge from '../components/common/StatusBadge';
import { formatStorefrontPrice } from '../components/storefront/price';
import StorefrontLayout from '../components/storefront/StorefrontLayout';
import { getOrderStatusLabel } from '../config/order-status';
import { ROUTES } from '../config/routes';
import { getAuthErrorMessage } from '../lib/api';
import { customerApi } from '../lib/customer-api';

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatAddress(snapshot) {
  return [snapshot?.street, snapshot?.ward, snapshot?.district, snapshot?.province]
    .filter(Boolean)
    .join(', ') || '—';
}

function OrderItemImage({ item }) {
  if (!item.productImageUrl) {
    return <div className="my-order-item__image my-order-item__image--placeholder" aria-label={`Chưa có ảnh cho ${item.productName}`}><PackageCheck size={18} /></div>;
  }

  return <img className="my-order-item__image" src={item.productImageUrl} alt={item.productName} />;
}

export default function MyOrderDetailPage() {
  const { orderNumber } = useParams();
  const { requestWithAuthentication } = useAuth();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelVisible, setCancelVisible] = useState(false);
  const [cancellationNote, setCancellationNote] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const loadOrder = useCallback(async () => {
    const result = await customerApi.getOwnOrder(requestWithAuthentication, orderNumber);
    setOrder(result);
    return result;
  }, [orderNumber, requestWithAuthentication]);

  useEffect(() => {
    let isCurrent = true;
    setLoading(true);
    setError('');

    customerApi.getOwnOrder(requestWithAuthentication, orderNumber)
      .then((result) => {
        if (isCurrent) {
          setOrder(result);
        }
      })
      .catch((requestError) => {
        if (isCurrent) {
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
    };
  }, [orderNumber, requestWithAuthentication]);

  const cancelOrder = async (event) => {
    event.preventDefault();
    if (!order || cancelBusy) {
      return;
    }

    setCancelBusy(true);
    setError('');
    setSuccessMessage('');

    try {
      await customerApi.cancelOwnOrder(requestWithAuthentication, order.orderNumber, cancellationNote);
      const refreshedOrder = await loadOrder();
      setCancelVisible(false);
      setCancellationNote('');
      setSuccessMessage(`Đơn hàng đã được chuyển sang “${getOrderStatusLabel(refreshedOrder.status)}”.`);
    } catch (requestError) {
      setError(getAuthErrorMessage(requestError));
      if (requestError?.code === 'INVALID_ORDER_TRANSITION') {
        loadOrder().catch(() => undefined);
      }
    } finally {
      setCancelBusy(false);
    }
  };

  return (
    <StorefrontLayout title="Chi tiết đơn hàng">
      <section className="storefront-container my-order-detail">
        <Link className="shop-back-link" to={ROUTES.myOrders}><ArrowLeft size={17} /> Quay lại đơn mua</Link>

        {loading ? <div className="my-order-detail-state" role="status">Đang tải đơn hàng…</div> : null}
        {!loading && error && !order ? (
          <div className="my-order-detail-state">
            <AuthAlert>{error}</AuthAlert>
            <Link className="secondary-button" to={ROUTES.myOrders}>Quay lại</Link>
          </div>
        ) : null}

        {order ? (
          <article className="my-order-detail-card">
            <header className="my-order-detail-card__header">
              <div>
                <p className="shop-eyebrow">MÃ ĐƠN HÀNG</p>
                <h2>{order.orderNumber}</h2>
                <time dateTime={order.createdAt}>Tạo lúc {formatDateTime(order.createdAt)}</time>
              </div>
              <div className="my-order-statuses">
                <StatusBadge status={order.status} label={getOrderStatusLabel(order.status)} />
                <StatusBadge status={order.paymentStatus} />
              </div>
            </header>

            <div className="my-order-detail-grid">
              <section className="my-order-detail-section">
                <h2>Giao hàng</h2>
                <dl className="my-order-address">
                  <div><dt>Người nhận</dt><dd>{order.shippingSnapshot.recipientName}</dd></div>
                  <div><dt>Số điện thoại</dt><dd>{order.shippingSnapshot.phone}</dd></div>
                  <div><dt>Địa chỉ</dt><dd>{formatAddress(order.shippingSnapshot)}</dd></div>
                  {order.shippingSnapshot.postalCode ? <div><dt>Mã bưu chính</dt><dd>{order.shippingSnapshot.postalCode}</dd></div> : null}
                </dl>
              </section>
              <section className="my-order-detail-section">
                <h2>Thanh toán</h2>
                <dl className="my-order-address">
                  <div><dt>Phương thức</dt><dd>{order.paymentMethod === 'COD' ? 'Thanh toán khi nhận hàng' : order.paymentMethod}</dd></div>
                  <div><dt>Trạng thái</dt><dd>{order.paymentStatus === 'PAID' ? 'Đã thanh toán' : 'Chưa thanh toán'}</dd></div>
                  {order.paidAt ? <div><dt>Thời điểm thanh toán</dt><dd>{formatDateTime(order.paidAt)}</dd></div> : null}
                </dl>
              </section>
            </div>

            <section className="my-order-detail-section">
              <h2>Sản phẩm ({order.items.length})</h2>
              <div className="my-order-items">
                {order.items.map((item) => (
                  <article className="my-order-item" key={item.id}>
                    <OrderItemImage item={item} />
                    <div>
                      <strong>{item.productName}</strong>
                      <span>SKU: {item.productSku}</span>
                      <span>{formatStorefrontPrice(item.unitPrice)} × {item.quantity}</span>
                    </div>
                    <strong>{formatStorefrontPrice(item.lineTotal)}</strong>
                  </article>
                ))}
              </div>
              <dl className="my-order-totals">
                <div><dt>Tạm tính</dt><dd>{formatStorefrontPrice(order.subtotal)}</dd></div>
                <div><dt>Phí giao hàng</dt><dd>{formatStorefrontPrice(order.shippingFee)}</dd></div>
                {Number(order.discountAmount) > 0 ? <div><dt>Giảm giá</dt><dd>-{formatStorefrontPrice(order.discountAmount)}</dd></div> : null}
                <div className="my-order-totals__total"><dt>Tổng cộng</dt><dd>{formatStorefrontPrice(order.totalAmount)}</dd></div>
              </dl>
            </section>

            {order.customerNote ? <section className="my-order-detail-section"><h2>Ghi chú</h2><p className="my-order-note">{order.customerNote}</p></section> : null}

            <section className="my-order-detail-section">
              <h2>Lịch sử trạng thái</h2>
              <ol className="my-order-history">
                {order.statusHistory.map((history) => (
                  <li key={history.id}>
                    <div><strong>{history.fromStatus ? `${getOrderStatusLabel(history.fromStatus)} → ` : ''}{getOrderStatusLabel(history.toStatus)}</strong>{history.note ? <span>{history.note}</span> : null}</div>
                    <time dateTime={history.createdAt}>{formatDateTime(history.createdAt)}</time>
                  </li>
                ))}
              </ol>
            </section>

            {order.status === 'PENDING' ? (
              <section className="my-order-detail-section my-order-cancellation">
                <h2>Hủy đơn hàng</h2>
                {!cancelVisible ? <button className="secondary-button" type="button" onClick={() => { setCancelVisible(true); setSuccessMessage(''); }}>Yêu cầu hủy đơn</button> : (
                  <form onSubmit={cancelOrder}>
                    <label htmlFor="customer-cancellation-note">Lý do hủy (không bắt buộc)</label>
                    <textarea id="customer-cancellation-note" value={cancellationNote} onChange={(event) => setCancellationNote(event.target.value)} maxLength="500" disabled={cancelBusy} placeholder="Nhập lý do nếu bạn muốn" />
                    <div>
                      <button className="secondary-button" type="button" disabled={cancelBusy} onClick={() => { setCancelVisible(false); setCancellationNote(''); }}>Quay lại</button>
                      <button className="primary-button" type="submit" disabled={cancelBusy}>{cancelBusy ? 'Đang hủy…' : 'Xác nhận hủy đơn'}</button>
                    </div>
                  </form>
                )}
                <AuthAlert>{error}</AuthAlert>
                {successMessage ? <p className="form-success" role="status">{successMessage}</p> : null}
              </section>
            ) : null}
          </article>
        ) : null}
      </section>
    </StorefrontLayout>
  );
}
