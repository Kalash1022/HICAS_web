import { useCallback, useEffect, useState } from 'react';

const EMPTY_PAGINATION = Object.freeze({ page: 1, limit: 10, total: 0, totalPages: 1 });

export default function usePaginatedList({ loadPage, page, limit, search, queryParameters }) {
  const [items, setItems] = useState([]);
  const [pagination, setPagination] = useState(EMPTY_PAGINATION);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let isCurrent = true;

    setLoading(true);
    setError('');

    loadPage({
      page,
      limit,
      ...(queryParameters || {}),
      ...(search === undefined ? {} : { search }),
      signal: controller.signal,
    })
      .then((result) => {
        if (!isCurrent) {
          return;
        }

        setItems(result.items);
        setPagination(result.pagination);
      })
      .catch((requestError) => {
        if (!isCurrent || requestError?.name === 'AbortError') {
          return;
        }

        setItems([]);
        setPagination((currentPagination) => ({
          ...currentPagination,
          page,
          limit,
        }));
        setError(requestError);
      })
      .finally(() => {
        if (isCurrent) {
          setLoading(false);
        }
      });

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [limit, loadPage, page, queryParameters, requestVersion, search]);

  const retry = useCallback(() => {
    setRequestVersion((version) => version + 1);
  }, []);

  return { items, pagination, loading, error, retry };
}
