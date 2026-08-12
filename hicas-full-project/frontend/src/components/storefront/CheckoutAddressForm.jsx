import { useState } from 'react';
import FormField from '../common/FormField';

const EMPTY_ADDRESS = Object.freeze({
  recipientName: '',
  phone: '',
  province: '',
  district: '',
  ward: '',
  street: '',
  postalCode: '',
  isDefault: false,
});

export default function CheckoutAddressForm({ busy, onSubmit }) {
  const [address, setAddress] = useState(EMPTY_ADDRESS);

  const updateField = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setAddress((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit({
      recipientName: address.recipientName.trim(),
      phone: address.phone.trim(),
      province: address.province.trim(),
      district: address.district.trim(),
      ward: address.ward.trim(),
      street: address.street.trim(),
      ...(address.postalCode.trim() ? { postalCode: address.postalCode.trim() } : {}),
      isDefault: address.isDefault,
    });
  };

  return (
    <form className="checkout-address-form" onSubmit={handleSubmit}>
      <div className="checkout-address-form__grid">
        <FormField label="Người nhận *" value={address.recipientName} onChange={updateField('recipientName')} maxLength="160" required disabled={busy} />
        <FormField label="Số điện thoại *" value={address.phone} onChange={updateField('phone')} maxLength="32" required disabled={busy} />
        <FormField label="Tỉnh / Thành phố *" value={address.province} onChange={updateField('province')} maxLength="120" required disabled={busy} />
        <FormField label="Quận / Huyện *" value={address.district} onChange={updateField('district')} maxLength="120" required disabled={busy} />
        <FormField label="Phường / Xã *" value={address.ward} onChange={updateField('ward')} maxLength="120" required disabled={busy} />
        <FormField label="Mã bưu chính" value={address.postalCode} onChange={updateField('postalCode')} maxLength="32" disabled={busy} />
      </div>
      <FormField label="Địa chỉ chi tiết *" value={address.street} onChange={updateField('street')} maxLength="500" required disabled={busy} />
      <label className="checkout-default-address">
        <input type="checkbox" checked={address.isDefault} onChange={updateField('isDefault')} disabled={busy} />
        Đặt làm địa chỉ mặc định
      </label>
      <button className="secondary-button" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu địa chỉ'}</button>
    </form>
  );
}
