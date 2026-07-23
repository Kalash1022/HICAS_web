export const userFormFields = [
  { name: 'name', label: 'Tên người dùng *', placeholder: 'Nhập tên người dùng' },
  { name: 'email', label: 'Email *', placeholder: 'Nhập email', type: 'email' },
  { name: 'birthDate', label: 'Ngày sinh *', placeholder: 'YYYY/MM/DD', iconName: 'calendar' },
  { name: 'phone', label: 'Số điện thoại *', placeholder: 'Nhập số điện thoại', type: 'tel' },
  { name: 'avatar', label: 'Avatar *', placeholder: 'Nhập link ảnh avatar', type: 'url' },
];

export const productFormFields = [
  { name: 'name', label: 'Tên sản phẩm *', placeholder: 'Nhập tên sản phẩm' },
  { name: 'price', label: 'Giá *', placeholder: 'Nhập giá sản phẩm' },
  { name: 'stock', label: 'Số lượng *', placeholder: 'Nhập số lượng sản phẩm', type: 'number' },
  { name: 'description', label: 'Mô tả', placeholder: 'Nhập mô tả', multiline: true },
  { name: 'image', label: 'Ảnh sản phẩm *', placeholder: 'Nhập link ảnh sản phẩm', type: 'url' },
];
