import { apiPaginatedRequest, apiRequest } from './api';

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

export const storefrontApi = Object.freeze({
  listCategories({ signal } = {}) {
    return apiRequest('categories', { signal });
  },
  listProducts(parameters = {}) {
    const { signal, ...query } = parameters;
    return apiPaginatedRequest(buildQueryPath('products', query), { signal });
  },
  getProduct(slug, { signal } = {}) {
    return apiRequest('products/' + encodeURIComponent(slug), { signal });
  },
});
