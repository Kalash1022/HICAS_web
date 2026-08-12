import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ImagePlus, Pencil, Trash2, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import AuthAlert from '../components/auth/AuthAlert';
import { IconButton, PrimaryButton } from '../components/common/Buttons';
import FormField from '../components/common/FormField';
import StatusBadge from '../components/common/StatusBadge';
import { productEditPath, ROUTES } from '../config/routes';
import { adminApi } from '../lib/admin-api';
import { getAuthErrorMessage } from '../lib/api';

function formatQuantity(value) {
  return new Intl.NumberFormat('vi-VN').format(value || 0);
}

export default function ProductManagementPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { requestWithAuthentication } = useAuth();
  const fileInputRef = useRef(null);
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [quantityDelta, setQuantityDelta] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const reloadProduct = useCallback(async () => {
    const result = await adminApi.getProduct(requestWithAuthentication, productId);
    setProduct(result);
    return result;
  }, [productId, requestWithAuthentication]);

  useEffect(() => {
    let isCurrent = true;

    adminApi.getProduct(requestWithAuthentication, productId)
      .then((result) => {
        if (isCurrent) {
          setProduct(result);
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
  }, [productId, requestWithAuthentication]);

  const beginAction = (action) => {
    setBusyAction(action);
    setError('');
    setSuccessMessage('');
  };

  const endAction = () => {
    setBusyAction('');
  };

  const handleUpload = async (event) => {
    event.preventDefault();

    if (!imageFile || !product) {
      setError('Hãy chọn một tệp ảnh trước khi tải lên.');
      return;
    }

    beginAction('upload');
    const formData = new FormData();
    formData.append('image', imageFile);
    formData.append('altText', product.name);
    formData.append('isPrimary', String(product.images.length === 0));

    try {
      await adminApi.uploadProductImage(requestWithAuthentication, productId, formData);
      await reloadProduct();
      setImageFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setSuccessMessage('Đã tải ảnh sản phẩm lên.');
    } catch (uploadError) {
      setError(getAuthErrorMessage(uploadError));
    } finally {
      endAction();
    }
  };

  const handleDeleteImage = async (imageId) => {
    if (product?.status === 'ACTIVE' && product.images.length === 1) {
      setError('Không thể xóa ảnh duy nhất của sản phẩm đang hoạt động. Hãy tải ảnh thay thế trước.');
      return;
    }

    if (!window.confirm('Xóa ảnh này khỏi sản phẩm?')) {
      return;
    }

    beginAction('delete-image-' + imageId);

    try {
      await adminApi.deleteProductImage(requestWithAuthentication, productId, imageId);
      await reloadProduct();
      setSuccessMessage('Đã xóa ảnh sản phẩm.');
    } catch (deleteError) {
      setError(getAuthErrorMessage(deleteError));
    } finally {
      endAction();
    }
  };

  const handleInventoryAdjustment = async (event) => {
    event.preventDefault();
    const parsedDelta = Number(quantityDelta);

    if (!Number.isInteger(parsedDelta) || parsedDelta === 0) {
      setError('Nhập số nguyên khác 0 để điều chỉnh tồn kho.');
      return;
    }
    if (!reason.trim()) {
      setError('Nhập lý do điều chỉnh tồn kho.');
      return;
    }
    if (!product?.inventory) {
      setError('Sản phẩm chưa có thông tin tồn kho hợp lệ.');
      return;
    }

    beginAction('inventory');

    try {
      await adminApi.adjustInventory(requestWithAuthentication, productId, {
        quantityDelta: parsedDelta,
        expectedVersion: product.inventory.version,
        reason: reason.trim(),
      });
      await reloadProduct();
      setQuantityDelta('');
      setReason('');
      setSuccessMessage('Đã ghi nhận điều chỉnh tồn kho.');
    } catch (adjustmentError) {
      setError(getAuthErrorMessage(adjustmentError));
      if (adjustmentError?.code === 'INVENTORY_VERSION_CONFLICT') {
        await reloadProduct().catch(() => undefined);
      }
    } finally {
      endAction();
    }
  };

  const handleActivate = async () => {
    if (!product) {
      return;
    }

    beginAction('activate');

    try {
      const updatedProduct = await adminApi.updateProductStatus(
        requestWithAuthentication,
        productId,
        'ACTIVE',
      );
      setProduct(updatedProduct);
      setSuccessMessage('Sản phẩm đã được kích hoạt.');
    } catch (activationError) {
      setError(getAuthErrorMessage(activationError));
    } finally {
      endAction();
    }
  };

  return (
    <main className="modal-stage">
      <section className="entity-modal product-management-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal-header">
          <h1 id="modal-title">Ảnh &amp; tồn kho sản phẩm</h1>
          <IconButton label="Đóng" onClick={() => navigate(ROUTES.products)}><X size={20} /></IconButton>
        </header>

        {loading ? (
          <div className="modal-state">Đang tải sản phẩm…</div>
        ) : error && !product ? (
          <div className="modal-state">
            <AuthAlert>{error}</AuthAlert>
            <button className="secondary-button" type="button" onClick={() => navigate(ROUTES.products)}>Quay lại</button>
          </div>
        ) : product ? (
          <div className="product-management-content">
            <section className="product-management-section product-management-section--images" aria-labelledby="product-images-heading">
              <div className="product-management-heading">
                <div>
                  <h2 id="product-images-heading">Ảnh sản phẩm</h2>
                  <p>{product.images.length}/10 ảnh · Tải JPEG, PNG hoặc WebP (tối đa 5 MB)</p>
                </div>
                <button className="secondary-button" type="button" onClick={() => navigate(productEditPath(product.id))}>
                  <Pencil size={15} /> Sửa thông tin
                </button>
              </div>

              <form className="product-upload-form" onSubmit={handleUpload}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={Boolean(busyAction)}
                  onChange={(event) => setImageFile(event.target.files?.[0] || null)}
                />
                <PrimaryButton type="submit" disabled={!imageFile || Boolean(busyAction)}>
                  <ImagePlus size={17} /> {busyAction === 'upload' ? 'Đang tải…' : 'Tải ảnh lên'}
                </PrimaryButton>
              </form>

              {product.images.length > 0 ? (
                <div className="product-image-grid">
                  {product.images.map((image) => (
                    <figure className="product-management-image" key={image.id}>
                      <img src={image.url} alt={image.altText || product.name} />
                      {image.isPrimary ? <figcaption>Ảnh chính</figcaption> : null}
                      <IconButton
                        label={`Xóa ảnh ${image.altText || product.name}`}
                        disabled={Boolean(busyAction)}
                        onClick={() => handleDeleteImage(image.id)}
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </figure>
                  ))}
                </div>
              ) : <p className="product-empty-copy">Chưa có ảnh. Thêm ít nhất một ảnh trước khi kích hoạt sản phẩm.</p>}
            </section>

            <section className="product-management-section" aria-labelledby="inventory-heading">
              <div className="product-management-heading">
                <div>
                  <h2 id="inventory-heading">Tồn kho</h2>
                  <p>Điều chỉnh được ghi lịch sử và dùng kiểm soát phiên bản.</p>
                </div>
                <StatusBadge status={product.status} />
              </div>
              <dl className="inventory-summary">
                <div><dt>Tổng tồn</dt><dd>{formatQuantity(product.inventory?.quantity)}</dd></div>
                <div><dt>Đã giữ</dt><dd>{formatQuantity(product.inventory?.reservedQuantity)}</dd></div>
                <div><dt>Khả dụng</dt><dd>{formatQuantity((product.inventory?.quantity || 0) - (product.inventory?.reservedQuantity || 0))}</dd></div>
              </dl>
              <form className="inventory-adjustment-form" onSubmit={handleInventoryAdjustment}>
                <FormField
                  label="Điều chỉnh (+/-)"
                  type="number"
                  placeholder="Ví dụ: 25 hoặc -3"
                  value={quantityDelta}
                  onChange={(event) => setQuantityDelta(event.target.value)}
                  disabled={Boolean(busyAction)}
                />
                <FormField
                  label="Lý do"
                  placeholder="Nhập lý do điều chỉnh"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  disabled={Boolean(busyAction)}
                />
                <PrimaryButton type="submit" disabled={Boolean(busyAction)}>
                  {busyAction === 'inventory' ? 'Đang ghi nhận…' : 'Cập nhật tồn kho'}
                </PrimaryButton>
              </form>

              {product.status !== 'ACTIVE' ? (
                <div className="product-activation">
                  <p>Kích hoạt chỉ khả dụng sau khi có ít nhất một ảnh và danh mục đang hoạt động.</p>
                  <PrimaryButton type="button" disabled={Boolean(busyAction) || product.images.length === 0} onClick={handleActivate}>
                    <CheckCircle2 size={17} /> {busyAction === 'activate' ? 'Đang kích hoạt…' : 'Kích hoạt sản phẩm'}
                  </PrimaryButton>
                </div>
              ) : null}
              <AuthAlert>{error}</AuthAlert>
              {successMessage ? <p className="form-success" role="status">{successMessage}</p> : null}
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}
