import { ROUTES } from '../config/routes';

const RETURN_PATH_STORAGE_KEY = 'hicas.auth.return-path';

function safePath(path) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')
    ? path
    : null;
}

export function getReturnPath(locationState, fallback = ROUTES.shop) {
  const from = locationState?.from || locationState?.returnTo;

  if (typeof from === 'string') {
    return safePath(from) || fallback;
  }

  if (!from || typeof from.pathname !== 'string') {
    return fallback;
  }

  const path = from.pathname + (from.search || '') + (from.hash || '');
  return safePath(path) || fallback;
}

export function rememberReturnPath(path) {
  window.sessionStorage.setItem(RETURN_PATH_STORAGE_KEY, safePath(path) || ROUTES.shop);
}

export function getRememberedReturnPath() {
  return safePath(window.sessionStorage.getItem(RETURN_PATH_STORAGE_KEY)) || ROUTES.shop;
}

export function consumeRememberedReturnPath() {
  const path = getRememberedReturnPath();
  window.sessionStorage.removeItem(RETURN_PATH_STORAGE_KEY);
  return path;
}

export function clearRememberedReturnPath() {
  window.sessionStorage.removeItem(RETURN_PATH_STORAGE_KEY);
}
