import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, PackageCheck } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import AuthAlert from '../components/auth/AuthAlert';
import { PrimaryButton } from '../components/common/Buttons';
import FormField from '../components/common/FormField';
import StatusBadge from '../components/common/StatusBadge';
import AppShell from '../components/layout/AppShell';
import { getOrderStatusLabel, getOrderTransitions } from '../config/order-status';
import { ROUTES } from '../config/routes';
import { adminApi } from '../lib/admin-api';
import { getAuthErrorMessage } from '../lib/api';

function formatMoney(value, currency) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return '—';
  }

  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: currency || 'VND',
    maximumFractionDigits: 0,
  }).format(amount);
}

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
  if (!snapshot) {
    return '—';
  }

  return [snapshot.street, snapshot.ward, snapshot.district, snapshot.province]
    .filter(Boolean)
    .join(', ');
}

function ProductImage({ url, name }) {
  if (!url) {
    return <div className="order-item-image order-item-image--placeholder" aria-label={`Chưa có ảnh ${name}`}><PackageCheck size={18} /></div>;
  }

  return <img className="order-item-image" src={url} alt={name} />;
}

function OrderStateAction({ transition, busy, onRun }) {
  return (
    <button
      className={transition.status === 'CANCELLED' ? 'secondary-button order-cancel-button' : 'primary-button'}
      type="button"
      disabled={busy}
      onClick={() => onRun(transition)}
    >
      {transition.label}
    </button>
  );
}

export default function OrderDetailPage() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { requestWithAuthentication } = useAuth();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pendingTransition, setPendingTransition] = useState(null);
  const [cancellationNote, setCancellationNote] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const reloadOrder = useCallback(async () => {
    const result = await adminApi.getOrder(requestWithAuthentication, orderId);
    setOrder(result);
    return result;
  }, [orderId, requestWithAuthentication]);

  useEffect(() => {
    let isCurrent = true;

    adminApi.getOrder(requestWithAuthentication, orderId)
      .then((result) => {
        if (isCurrent) {
          setOrder(result);
        }
      })
      .catch((loadError) => {
        if (isCurrent) {
          setError(getAuthErrorMessage(loadError));
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
  }, [orderId, requestWithAuthentication]);

  const applyTransition = async (transition, note = '') => {
    if (!order) {
      return;
    }
    if (transition.requiresNote && !note.trim()) {
      setError('Nhập lý do hủy đơn trước khi tiếp tục.');
      return;
    }

    setBusy(true);
    setError('');
    setSuccessMessage('');

    try {
      await adminApi.updateOrderStatus(requestWithAuthentication, order.id, {
        status: transition.status,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      const updatedOrder = await reloadOrder();
      setPendingTransition(null);
      setCancellationNote('');
      setSuccessMessage(`Đã chuyển đơn hàng sang “${getOrderStatusLabel(updatedOrder.status)}”.`);
    } catch (transitionError) {
      setError(getAuthErrorMessage(transitionError));
      if (transitionError?.code === 'INVALID_ORDER_TRANSITION') {
        await reloadOrder().catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  };

  const beginTransition = async (transition) => {
    if (transition.requiresNote) {
      setPendingTransition(transition);
      setError('');
      setSuccessMessage('');
      return;
    }

    const confirmed = window.confirm(
      `Chuyển đơn hàng sang “${getOrderStatusLabel(transition.status)}”?`,
    );
    if (confirmed) {
      await applyTransition(transition);
    }
  };

  const title = order ? `Đơn hàng ${order.orderNumber}` : 'Chi tiết đơn hàng';
  const transitions = order ? getOrderTransitions(order.status) : [];

  return (
    <AppShell title={title} toolbar={null}>
      <section className="order-detail-card" aria-busy={loading || busy}>
        <header className="order-detail-header">
          <button className="secondary-button order-back-button" type="button" onClick={() => navigate(ROUTES.orders)}>
            <ArrowLeft size={16} /> Danh sách đơn hàng
          </button>
          {order ? (
            <div className="order-status-summary">
              <StatusBadge status={order.status} label={getOrderStatusLabel(order.status)} />
              <StatusBadge status={order.paymentStatus} />
            </div>
          ) : null}
        </header>

        {loading ? <div className="order-detail-state">Đang tải đơn hàng…</div> : null}
        {!loading && error && !order ? (
          <div className="order-detail-state">
            <AuthAlert>{error}</AuthAlert>
            <button className="secondary-button" type="button" onClick={() => navigate(ROUTES.orders)}>Quay lại</button>
          </div>
        ) : null}

        {order ? (
          <div className="order-detail-content">
            <section className="order-detail-section order-detail-overview" aria-labelledby="order-overview-heading">
              <div>
                <p className="order-eyebrow">Mã đơn hàng</p>
                <h2 id="order-overview-heading">{order.orderNumber}</h2>
                <p className="order-detail-muted">Tạo lúc {formatDateTime(order.createdAt)}</p>
              </div>
              <dl className="order-overview-values">
                <div><dt>Phương thức</dt><dd>{order.paymentMethod === 'COD' ? 'Thanh toán khi nhận hàng' : order.paymentMethod}</dd></div>
                <div><dt>Thanh toán</dt><dd>{order.paymentStatus === 'PAID' ? 'Đã thanh toán' : 'Chưa thanh toán'}</dd></div>
                <div><dt>Thời điểm thanh toán</dt><dd>{order.paidAt ? formatDateTime(order.paidAt) : '—'}</dd></div>
              </dl>
            </section>

            <div className="order-detail-columns">
              <section className="order-detail-section" aria-labelledby="order-customer-heading">
                <h2 id="order-customer-heading">Khách hàng &amp; giao hàng</h2>
                <dl className="order-contact-list">
                  <div><dt>Khách hàng</dt><dd>{order.customer.fullName}</dd></div>
                  <div><dt>Email</dt><dd>{order.customer.email}</dd></div>
                  <div><dt>Người nhận</dt><dd>{order.shippingSnapshot.recipientName}</dd></div>
                  <div><dt>Số điện thoại</dt><dd>{order.shippingSnapshot.phone}</dd></div>
                  <div><dt>Địa chỉ</dt><dd>{formatAddress(order.shippingSnapshot)}</dd></div>
                  {order.shippingSnapshot.postalCode ? <div><dt>Mã bưu chính</dt><dd>{order.shippingSnapshot.postalCode}</dd></div> : null}
                </dl>
              </section>

              <section className="order-detail-section order-actions-section" aria-labelledby="order-actions-heading">
                <h2 id="order-actions-heading">Thao tác đơn hàng</h2>
                {transitions.length > 0 ? (
                  <div className="order-transition-actions">
                    {transitions.map((transition) => (
                      <OrderStateAction
                        transition={transition}
                        busy={busy}
                        onRun={beginTransition}
                        key={transition.status}
                      />
                    ))}
                  </div>
                ) : <p className="order-detail-muted">Đơn hàng đã kết thúc, không còn thao tác phù hợp.</p>}
                {pendingTransition ? (
                  <form className="order-cancellation-form" onSubmit={(event) => {
                    event.preventDefault();
                    applyTransition(pendingTransition, cancellationNote);
                  }}>
                    <FormField
                      label="Lý do hủy *"
                      multiline
                      maxLength="500"
                      placeholder="Nêu lý do hoàn tồn kho"
                      value={cancellationNote}
                      disabled={busy}
                      onChange={(event) => setCancellationNote(event.target.value)}
                      required
                    />
                    <div className="order-cancellation-actions">
                      <button className="secondary-button" type="button" disabled={busy} onClick={() => {
                        setPendingTransition(null);
                        setCancellationNote('');
                      }}>Không hủy</button>
                      <PrimaryButton type="submit" disabled={busy}>{busy ? 'Đang hủy…' : 'Xác nhận hủy'}</PrimaryButton>
                    </div>
                  </form>
                ) : null}
                <AuthAlert>{error}</AuthAlert>
                {successMessage ? <p className="form-success" role="status">{successMessage}</p> : null}
              </section>
            </div>

            <section className="order-detail-section" aria-labelledby="order-items-heading">
              <div className="order-section-heading">
                <h2 id="order-items-heading">Sản phẩm ({order.items.length})</h2>
                <span>{formatMoney(order.totalAmount, order.currency)}</span>
              </div>
              <div className="order-items-list">
                {order.items.map((item) => (
                  <article className="order-item" key={item.id}>
                    <ProductImage url={item.productImageUrl} name={item.productName} />
                    <div className="order-item-copy">
                      <strong>{item.productName}</strong>
                      <span>SKU: {item.productSku}</span>
                      <span>{formatMoney(item.unitPrice, order.currency)} × {item.quantity}</span>
                    </div>
                    <strong>{formatMoney(item.lineTotal, order.currency)}</strong>
                  </article>
                ))}
              </div>
              <dl className="order-totals">
                <div><dt>Tạm tính</dt><dd>{formatMoney(order.subtotal, order.currency)}</dd></div>
                <div><dt>Phí giao hàng</dt><dd>{formatMoney(order.shippingFee, order.currency)}</dd></div>
                {Number(order.discountAmount) > 0 ? <div><dt>Giảm giá</dt><dd>-{formatMoney(order.discountAmount, order.currency)}</dd></div> : null}
                <div className="order-total"><dt>Tổng cộng</dt><dd>{formatMoney(order.totalAmount, order.currency)}</dd></div>
              </dl>
            </section>

            {order.customerNote ? (
              <section className="order-detail-section" aria-labelledby="order-note-heading">
                <h2 id="order-note-heading">Ghi chú của khách</h2>
                <p className="order-note">{order.customerNote}</p>
              </section>
            ) : null}

            <section className="order-detail-section" aria-labelledby="order-history-heading">
              <h2 id="order-history-heading">Lịch sử trạng thái</h2>
              <ol className="order-history-list">
                {order.statusHistory.map((history) => (
                  <li key={history.id}>
                    <div>
                      <strong>{history.fromStatus ? `${getOrderStatusLabel(history.fromStatus)} → ` : ''}{getOrderStatusLabel(history.toStatus)}</strong>
                      {history.note ? <span>{history.note}</span> : null}
                    </div>
                    <time dateTime={history.createdAt}>{formatDateTime(history.createdAt)}</time>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
