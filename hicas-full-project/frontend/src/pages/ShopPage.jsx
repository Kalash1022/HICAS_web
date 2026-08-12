import { Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ProductCard from '../components/storefront/ProductCard';
import StorefrontLayout from '../components/storefront/StorefrontLayout';
import Pagination from '../components/common/Pagination';
import useDebouncedValue from '../hooks/useDebouncedValue';
import usePaginatedList from '../hooks/usePaginatedList';
import { getAuthErrorMessage } from '../lib/api';
import { storefrontApi } from '../lib/storefront-api';

const PAGE_LIMIT = 12;

function ProductGridState({ loading, error, onRetry }) {
  if (loading) {
    return <div className="shop-grid-state" role="status">Đang tải sản phẩm…</div>;
  }

  if (error) {
    return (
      <div className="shop-grid-state shop-grid-state--error" role="alert">
        <p>{error}</p>
        <button className="secondary-button" type="button" onClick={onRetry}>Thử lại</button>
      </div>
    );
  }

  return (
    <div className="shop-grid-state">
      <h2>Chưa có sản phẩm phù hợp</h2>
      <p>Hãy thay đổi từ khóa hoặc danh mục để xem thêm sản phẩm.</p>
    </div>
  );
}

export default function ShopPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [categories, setCategories] = useState([]);
  const [categoriesError, setCategoriesError] = useState('');
  const [categoryRequestVersion, setCategoryRequestVersion] = useState(0);
  const debouncedSearch = useDebouncedValue(search);
  const queryParameters = useMemo(
    () => ({ sort: '-createdAt', ...(categoryId ? { categoryId } : {}) }),
    [categoryId],
  );
  const loadProducts = useCallback((parameters) => storefrontApi.listProducts(parameters), []);
  const { items, pagination, loading, error, retry } = usePaginatedList({
    loadPage: loadProducts,
    page,
    limit: PAGE_LIMIT,
    search: debouncedSearch,
    queryParameters,
  });

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    setCategoriesError('');
    storefrontApi.listCategories({ signal: controller.signal })
      .then((result) => {
        if (isCurrent) {
          setCategories(result);
        }
      })
      .catch((requestError) => {
        if (isCurrent && requestError?.name !== 'AbortError') {
          setCategories([]);
          setCategoriesError(getAuthErrorMessage(requestError));
        }
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [categoryRequestVersion]);

  const changeSearch = (value) => {
    setSearch(value);
    setPage(1);
  };

  const changeCategory = (nextCategoryId) => {
    setCategoryId(nextCategoryId);
    setPage(1);
  };

  return (
    <StorefrontLayout title="Danh sách sản phẩm">
      <section className="shop-hero">
        <div className="storefront-container shop-hero__content">
          <p className="shop-eyebrow">HICAS STORE</p>
          <h2>Sản phẩm dành cho bạn</h2>
          <p>Khám phá các sản phẩm hiện đang được mở bán trong cửa hàng.</p>
          <label className="shop-search">
            <span className="sr-only">Tìm sản phẩm</span>
            <Search size={20} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => changeSearch(event.target.value)}
              placeholder="Tìm theo tên hoặc SKU"
              maxLength="160"
            />
          </label>
        </div>
      </section>

      <section className="storefront-container shop-catalog" aria-labelledby="catalog-heading">
        <div className="shop-catalog__heading">
          <div>
            <p className="shop-eyebrow">DANH MỤC</p>
            <h2 id="catalog-heading">Tất cả sản phẩm</h2>
          </div>
          <p>{pagination.total} sản phẩm</p>
        </div>

        <div className="shop-category-row" aria-label="Lọc theo danh mục">
          <button
            className={!categoryId ? 'shop-category-chip active' : 'shop-category-chip'}
            type="button"
            onClick={() => changeCategory('')}
          >
            Tất cả
          </button>
          {categories.map((category) => (
            <button
              className={category.id === categoryId ? 'shop-category-chip active' : 'shop-category-chip'}
              type="button"
              onClick={() => changeCategory(category.id)}
              key={category.id}
            >
              {category.name}
            </button>
          ))}
        </div>
        {categoriesError ? (
          <div className="shop-category-error" role="alert">
            Không thể tải danh mục. {categoriesError}
            <button type="button" onClick={() => setCategoryRequestVersion((version) => version + 1)}>Thử lại</button>
          </div>
        ) : null}

        {items.length > 0 ? (
          <div className="shop-product-grid" aria-busy={loading}>
            {items.map((product) => <ProductCard product={product} key={product.id} />)}
          </div>
        ) : <ProductGridState loading={loading} error={error ? getAuthErrorMessage(error) : ''} onRetry={retry} />}

        {items.length > 0 ? (
          <div className="shop-pagination">
            <Pagination {...pagination} onPageChange={setPage} />
          </div>
        ) : null}
      </section>
    </StorefrontLayout>
  );
}
