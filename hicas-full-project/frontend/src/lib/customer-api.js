function buildQueryPath(path, parameters = {}) {
  const searchParams = new URLSearchParams();

  Object.entries(parameters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value));
    }
  });

  const query = searchParams.toString();
  return query ? path + '?' + query : path;
}

export const customerApi = Object.freeze({
  getCart(request) {
    return request('cart');
  },
  addCartItem(request, item) {
    return request('cart/items', {
      method: 'POST',
      body: item,
    });
  },
  updateCartItem(request, itemId, quantity) {
    return request('cart/items/' + encodeURIComponent(itemId), {
      method: 'PATCH',
      body: { quantity },
    });
  },
  deleteCartItem(request, itemId) {
    return request('cart/items/' + encodeURIComponent(itemId), {
      method: 'DELETE',
    });
  },
  listAddresses(request) {
    return request('me/addresses');
  },
  createAddress(request, address) {
    return request('me/addresses', {
      method: 'POST',
      body: address,
    });
  },
  checkout(request, payload, idempotencyKey) {
    return request('orders', {
      method: 'POST',
      body: payload,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
  },
  listOrders(request, parameters = {}) {
    const { signal, ...query } = parameters;
    return request(buildQueryPath('orders', query), { signal, paginated: true });
  },
  getOwnOrder(request, orderNumber) {
    return request('orders/' + encodeURIComponent(orderNumber));
  },
  cancelOwnOrder(request, orderNumber, note) {
    return request('orders/' + encodeURIComponent(orderNumber) + '/cancel', {
      method: 'POST',
      body: note?.trim() ? { note: note.trim() } : {},
    });
  },
});
