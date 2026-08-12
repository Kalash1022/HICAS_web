export const ROUTES = Object.freeze({
  home: '/',
  cover: '/cover',
  login: '/login',
  googleCallback: '/auth/google/callback',
  mfa: '/auth/mfa',
  forbidden: '/forbidden',
  shop: '/shop',
  shopProduct: '/shop/products/:slug',
  cart: '/cart',
  checkout: '/checkout',
  myOrders: '/my-orders',
  myOrderDetail: '/my-orders/:orderNumber',
  products: '/products',
  categories: '/categories',
  orders: '/orders',
  orderDetail: '/orders/:orderId',
  createProduct: '/products/new',
  editProduct: '/products/:productId/edit',
  manageProduct: '/products/:productId/manage',
  users: '/users',
  createUser: '/users/new',
  editUser: '/users/:userId/edit',
});

export function userEditPath(userId) {
  return '/users/' + encodeURIComponent(userId) + '/edit';
}

export function productEditPath(productId) {
  return '/products/' + encodeURIComponent(productId) + '/edit';
}

export function productManagePath(productId) {
  return '/products/' + encodeURIComponent(productId) + '/manage';
}

export function orderDetailPath(orderId) {
  return '/orders/' + encodeURIComponent(orderId);
}

export function shopProductPath(slug) {
  return '/shop/products/' + encodeURIComponent(slug);
}

export function myOrderDetailPath(orderNumber) {
  return '/my-orders/' + encodeURIComponent(orderNumber);
}
