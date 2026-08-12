export const formatPrice = (value) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Number(value));
export const formatDate = (value) =>
  new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(new Date(value));
