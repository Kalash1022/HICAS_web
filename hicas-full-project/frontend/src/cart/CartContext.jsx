import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/auth-context';
import { customerApi } from '../lib/customer-api';
import { CartContext } from './cart-context';

const EMPTY_CART = Object.freeze({
  id: null,
  items: [],
  itemCount: 0,
  subtotal: '0.00',
  updatedAt: null,
});

export function CartProvider({ children }) {
  const { status, requestWithAuthentication } = useAuth();
  const [cart, setCart] = useState(EMPTY_CART);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refreshCart = useCallback(async () => {
    if (status !== 'authenticated') {
      setCart(EMPTY_CART);
      setError(null);
      setLoading(false);
      return EMPTY_CART;
    }

    setLoading(true);
    setError(null);

    try {
      const nextCart = await customerApi.getCart(requestWithAuthentication);
      setCart(nextCart);
      return nextCart;
    } catch (requestError) {
      setError(requestError);
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, [requestWithAuthentication, status]);

  useEffect(() => {
    refreshCart().catch(() => undefined);
  }, [refreshCart]);

  const value = useMemo(() => ({
    cart,
    loading,
    error,
    refreshCart,
  }), [cart, error, loading, refreshCart]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
