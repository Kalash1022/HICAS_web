import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthContext } from './auth-context';
import { ApiError, apiPaginatedRequest, apiRequest, authApi } from '../lib/api';

const GOOGLE_STATE_STORAGE_KEY = 'hicas.google.state';

function createAnonymousState() {
  return {
    status: 'anonymous',
    accessToken: null,
    user: null,
    pendingMfa: null,
  };
}

function isSessionResult(result) {
  return Boolean(result && result.accessToken && result.user);
}

function isMfaEnrollmentResult(result) {
  return Boolean(result && result.mfaEnrollmentRequired && result.enrollmentToken);
}

function isMfaChallengeResult(result) {
  return Boolean(result && result.mfaRequired && result.mfaToken);
}

function getGoogleState(authorizationUrl) {
  try {
    return new URL(authorizationUrl).searchParams.get('state');
  } catch {
    return null;
  }
}

function invalidAuthenticationResult() {
  return new ApiError({
    code: 'AUTH_RESPONSE_INVALID',
    message: 'Máy chủ trả về phản hồi đăng nhập không hợp lệ.',
  });
}

export function AuthProvider({ children }) {
  const [authState, setAuthState] = useState({
    status: 'restoring',
    accessToken: null,
    user: null,
    pendingMfa: null,
  });
  const restoreRequest = useRef(null);
  const refreshRequest = useRef(null);

  const applyAuthenticationResult = useCallback((result) => {
    if (isSessionResult(result)) {
      const nextState = {
        status: 'authenticated',
        accessToken: result.accessToken,
        user: result.user,
        pendingMfa: null,
      };
      setAuthState(nextState);
      return { kind: 'session', user: result.user };
    }

    if (isMfaEnrollmentResult(result)) {
      const pendingMfa = {
        type: 'enrollment',
        token: result.enrollmentToken,
        expiresIn: result.expiresIn,
      };
      setAuthState({
        status: 'mfa-required',
        accessToken: null,
        user: null,
        pendingMfa,
      });
      return { kind: 'mfa-enrollment', pendingMfa };
    }

    if (isMfaChallengeResult(result)) {
      const pendingMfa = {
        type: 'challenge',
        token: result.mfaToken,
        expiresIn: result.expiresIn,
      };
      setAuthState({
        status: 'mfa-required',
        accessToken: null,
        user: null,
        pendingMfa,
      });
      return { kind: 'mfa-challenge', pendingMfa };
    }

    throw invalidAuthenticationResult();
  }, []);

  useEffect(() => {
    if (!restoreRequest.current) {
      restoreRequest.current = authApi.refresh()
        .then((result) => (
          isSessionResult(result) ? { kind: 'session', result } : { kind: 'anonymous' }
        ))
        .catch(() => ({ kind: 'anonymous' }));
    }

    let isMounted = true;
    const request = restoreRequest.current;

    request.then((outcome) => {
      if (!isMounted) {
        return;
      }

      if (outcome.kind === 'session') {
        setAuthState((currentState) => {
          if (currentState.status !== 'restoring') {
            return currentState;
          }

          return {
            status: 'authenticated',
            accessToken: outcome.result.accessToken,
            user: outcome.result.user,
            pendingMfa: null,
          };
        });
        return;
      }

      setAuthState((currentState) => (
        currentState.status === 'restoring' ? createAnonymousState() : currentState
      ));
    });

    return () => {
      isMounted = false;
    };
  }, [applyAuthenticationResult]);

  const signIn = useCallback(async (credentials) => {
    const result = await authApi.login(credentials);
    return applyAuthenticationResult(result);
  }, [applyAuthenticationResult]);

  const startGoogleSignIn = useCallback(async () => {
    const result = await authApi.getGoogleAuthorizationUrl();
    const state = getGoogleState(result && result.authorizationUrl);

    if (!state) {
      throw new ApiError({
        code: 'OAUTH_STATE_INVALID',
        message: 'Máy chủ không thể tạo phiên đăng nhập Google hợp lệ.',
      });
    }

    window.sessionStorage.setItem(GOOGLE_STATE_STORAGE_KEY, state);
    window.location.assign(result.authorizationUrl);
  }, []);

  const finishGoogleSignIn = useCallback(async ({ code, state }) => {
    const expectedState = window.sessionStorage.getItem(GOOGLE_STATE_STORAGE_KEY);

    if (!code || !state || !expectedState || expectedState !== state) {
      window.sessionStorage.removeItem(GOOGLE_STATE_STORAGE_KEY);
      throw new ApiError({
        code: 'OAUTH_STATE_COOKIE_MISMATCH',
        message: 'Phiên đăng nhập Google không hợp lệ. Hãy bắt đầu lại.',
      });
    }

    try {
      const result = await authApi.completeGoogleCallback({ code, state });
      return applyAuthenticationResult(result);
    } finally {
      window.sessionStorage.removeItem(GOOGLE_STATE_STORAGE_KEY);
    }
  }, [applyAuthenticationResult]);

  const beginMfaEnrollment = useCallback(async () => {
    if (authState.pendingMfa?.type !== 'enrollment') {
      throw new ApiError({
        code: 'MFA_ENROLLMENT_TOKEN_INVALID',
        message: 'Phiên thiết lập xác thực hai lớp không còn hiệu lực.',
      });
    }

    return authApi.setupMfa(authState.pendingMfa.token);
  }, [authState.pendingMfa]);

  const completeMfaEnrollment = useCallback(async (code) => {
    if (authState.pendingMfa?.type !== 'enrollment') {
      throw new ApiError({
        code: 'MFA_ENROLLMENT_TOKEN_INVALID',
        message: 'Phiên thiết lập xác thực hai lớp không còn hiệu lực.',
      });
    }

    const result = await authApi.enableMfa(authState.pendingMfa.token, code);
    const authentication = applyAuthenticationResult(result);
    return { ...authentication, recoveryCodes: result.recoveryCodes || [] };
  }, [applyAuthenticationResult, authState.pendingMfa]);

  const completeMfaChallenge = useCallback(async ({ code, recoveryCode }) => {
    if (authState.pendingMfa?.type !== 'challenge') {
      throw new ApiError({
        code: 'MFA_CHALLENGE_INVALID',
        message: 'Phiên xác thực hai lớp không còn hiệu lực.',
      });
    }

    const payload = { mfaToken: authState.pendingMfa.token };
    if (code) {
      payload.code = code;
    } else {
      payload.recoveryCode = recoveryCode;
    }

    const result = await authApi.verifyMfa(payload);
    return applyAuthenticationResult(result);
  }, [applyAuthenticationResult, authState.pendingMfa]);

  const clearPendingMfa = useCallback(() => {
    setAuthState(createAnonymousState());
  }, []);

  const signOut = useCallback(async () => {
    setAuthState(createAnonymousState());

    try {
      await authApi.logout();
    } catch {
      // A local sign-out still prevents this browser tab from using an access token.
    }
  }, []);

  const refreshAccessToken = useCallback(async () => {
    if (!refreshRequest.current) {
      refreshRequest.current = authApi.refresh()
        .then((result) => {
          if (!isSessionResult(result)) {
            throw invalidAuthenticationResult();
          }

          applyAuthenticationResult(result);
          return result.accessToken;
        })
        .finally(() => {
          refreshRequest.current = null;
        });
    }

    return refreshRequest.current;
  }, [applyAuthenticationResult]);

  const requestWithAuthentication = useCallback(async (path, options = {}) => {
    const { paginated = false, ...requestOptions } = options;
    const execute = (accessToken) => (
      paginated
        ? apiPaginatedRequest(path, { ...requestOptions, accessToken })
        : apiRequest(path, { ...requestOptions, accessToken })
    );

    if (!authState.accessToken) {
      throw new ApiError({
        status: 401,
        code: 'AUTH_REQUIRED',
        message: 'Phiên đăng nhập không còn hiệu lực.',
      });
    }

    try {
      return await execute(authState.accessToken);
    } catch (requestError) {
      if (!(requestError instanceof ApiError) || requestError.status !== 401) {
        throw requestError;
      }

      try {
        return await execute(await refreshAccessToken());
      } catch (refreshError) {
        setAuthState(createAnonymousState());
        throw refreshError;
      }
    }
  }, [authState.accessToken, refreshAccessToken]);

  const value = useMemo(() => ({
    ...authState,
    signIn,
    startGoogleSignIn,
    finishGoogleSignIn,
    beginMfaEnrollment,
    completeMfaEnrollment,
    completeMfaChallenge,
    clearPendingMfa,
    requestWithAuthentication,
    signOut,
  }), [
    authState,
    beginMfaEnrollment,
    clearPendingMfa,
    completeMfaChallenge,
    completeMfaEnrollment,
    finishGoogleSignIn,
    requestWithAuthentication,
    signIn,
    signOut,
    startGoogleSignIn,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
