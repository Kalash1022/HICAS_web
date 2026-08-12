async function request(path, options) {
  const response = await fetch('/api' + path, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || 'Không thể xử lý yêu cầu.');
  return payload;
}

export const api = {
  login: (body) =>
    request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  listProducts: (filters) =>
    request(
      '/products?' +
        new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString()
    ),
  createProduct: (body) =>
    request('/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  listUsers: (search) => request('/users?search=' + encodeURIComponent(search)),
  createUser: (body) =>
    request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
};
