function buildQueryPath(path, parameters) {
  const searchParams = new URLSearchParams();

  Object.entries(parameters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value));
    }
  });

  const query = searchParams.toString();
  return query ? path + '?' + query : path;
}

function listRequest(path, request, { signal, ...parameters }) {
  return request(buildQueryPath(path, parameters), { signal, paginated: true });
}

export const adminApi = Object.freeze({
  listProducts(request, parameters) {
    return listRequest('admin/products', request, parameters);
  },
  listUsers(request, parameters) {
    return listRequest('admin/users', request, parameters);
  },
  listCategories(request, parameters) {
    return listRequest('admin/categories', request, parameters);
  },
  listOrders(request, parameters) {
    return listRequest('admin/orders', request, parameters);
  },
  getOrder(request, orderId) {
    return request('admin/orders/' + encodeURIComponent(orderId));
  },
  updateOrderStatus(request, orderId, payload) {
    return request('admin/orders/' + encodeURIComponent(orderId) + '/status', {
      method: 'PATCH',
      body: payload,
    });
  },
  createCategory(request, category) {
    return request('admin/categories', {
      method: 'POST',
      body: category,
    });
  },
  updateCategory(request, categoryId, category) {
    return request('admin/categories/' + encodeURIComponent(categoryId), {
      method: 'PATCH',
      body: category,
    });
  },
  deleteCategory(request, categoryId) {
    return request('admin/categories/' + encodeURIComponent(categoryId), {
      method: 'DELETE',
    });
  },
  getUser(request, userId) {
    return request('admin/users/' + encodeURIComponent(userId));
  },
  updateUserRole(request, userId, role) {
    return request('admin/users/' + encodeURIComponent(userId) + '/role', {
      method: 'PATCH',
      body: { role },
    });
  },
  updateUserStatus(request, userId, status) {
    return request('admin/users/' + encodeURIComponent(userId) + '/status', {
      method: 'PATCH',
      body: { status },
    });
  },
  resetUserMfa(request, userId) {
    return request('admin/users/' + encodeURIComponent(userId) + '/mfa/reset', {
      method: 'POST',
    });
  },
  getProduct(request, productId) {
    return request('admin/products/' + encodeURIComponent(productId));
  },
  uploadProductImage(request, productId, formData) {
    return request('admin/products/' + encodeURIComponent(productId) + '/images', {
      method: 'POST',
      body: formData,
    });
  },
  deleteProductImage(request, productId, imageId) {
    return request(
      'admin/products/' + encodeURIComponent(productId) + '/images/' + encodeURIComponent(imageId),
      { method: 'DELETE' },
    );
  },
  adjustInventory(request, productId, adjustment) {
    return request('admin/inventory/' + encodeURIComponent(productId) + '/adjustments', {
      method: 'POST',
      body: adjustment,
    });
  },
  updateProductStatus(request, productId, status) {
    return request('admin/products/' + encodeURIComponent(productId), {
      method: 'PATCH',
      body: { status },
    });
  },
});
