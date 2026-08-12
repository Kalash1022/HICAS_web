const DEFAULT_API_BASE_URL = 'http://localhost:3000/api/v1';

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL;

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function readString(value) {
  return typeof value === 'string' ? value : undefined;
}

function normaliseBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, '');
}

export class ApiError extends Error {
  constructor({ status = 0, code = 'NETWORK_ERROR', message, requestId }) {
    super(message || 'Unable to complete the request.');
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

async function readResponseBody(response) {
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

function toApiError(response, payload) {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : {};
  const meta = isRecord(payload) && isRecord(payload.meta) ? payload.meta : {};

  return new ApiError({
    status: response.status,
    code: readString(error.code) || 'HTTP_ERROR',
    message: readString(error.message) || 'The server could not complete this request.',
    requestId: readString(meta.requestId),
  });
}

export async function apiRequest(path, options = {}) {
  const {
    method = 'GET',
    body,
    accessToken,
    headers: additionalHeaders,
    signal,
    returnEnvelope = false,
  } = options;
  const headers = new Headers(additionalHeaders);
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  if (body !== undefined && !isFormData) {
    headers.set('Content-Type', 'application/json');
  }

  if (accessToken) {
    headers.set('Authorization', 'Bearer ' + accessToken);
  }

  let response;

  try {
    response = await fetch(normaliseBaseUrl(configuredApiBaseUrl) + '/' + path.replace(/^\/+/, ''), {
      method,
      headers,
      credentials: 'include',
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw error;
    }

    throw new ApiError({
      message: 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra backend và kết nối mạng.',
    });
  }

  const payload = await readResponseBody(response);

  if (!response.ok) {
    throw toApiError(response, payload);
  }

  if (returnEnvelope) {
    return payload;
  }

  if (isRecord(payload) && Object.prototype.hasOwnProperty.call(payload, 'data')) {
    return payload.data;
  }

  return payload;
}

export async function apiPaginatedRequest(path, options = {}) {
  const payload = await apiRequest(path, { ...options, returnEnvelope: true });

  if (
    !isRecord(payload) ||
    !Array.isArray(payload.data) ||
    !isRecord(payload.pagination) ||
    typeof payload.pagination.page !== 'number' ||
    typeof payload.pagination.limit !== 'number' ||
    typeof payload.pagination.total !== 'number' ||
    typeof payload.pagination.totalPages !== 'number'
  ) {
    throw new ApiError({
      code: 'PAGINATION_RESPONSE_INVALID',
      message: 'Máy chủ trả về dữ liệu phân trang không hợp lệ.',
    });
  }

  return {
    items: payload.data,
    pagination: payload.pagination,
  };
}

export const authApi = Object.freeze({
  login(credentials) {
    return apiRequest('auth/login', { method: 'POST', body: credentials });
  },
  refresh() {
    return apiRequest('auth/refresh', { method: 'POST' });
  },
  logout() {
    return apiRequest('auth/logout', { method: 'POST' });
  },
  getGoogleAuthorizationUrl() {
    return apiRequest('auth/google/url');
  },
  completeGoogleCallback(payload) {
    return apiRequest('auth/google/callback', { method: 'POST', body: payload });
  },
  setupMfa(enrollmentToken) {
    return apiRequest('auth/mfa/setup', {
      method: 'POST',
      body: {},
      accessToken: enrollmentToken,
    });
  },
  enableMfa(enrollmentToken, code) {
    return apiRequest('auth/mfa/enable', {
      method: 'POST',
      body: { code },
      accessToken: enrollmentToken,
    });
  },
  verifyMfa(payload) {
    return apiRequest('auth/mfa/verify', { method: 'POST', body: payload });
  },
});

export function getAuthErrorMessage(error) {
  if (!(error instanceof ApiError)) {
    return 'Đã có lỗi không xác định. Vui lòng thử lại.';
  }

  const messages = {
    AUTH_INVALID_CREDENTIALS: 'Email hoặc mật khẩu không chính xác.',
    AUTH_EMAIL_NOT_VERIFIED: 'Tài khoản chưa xác thực email.',
    AUTH_ACCOUNT_BLOCKED: 'Tài khoản này đã bị khóa.',
    AUTH_RATE_LIMITED: 'Bạn đã thử quá nhiều lần. Vui lòng thử lại sau.',
    AUTH_REQUIRED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
    AUTH_FORBIDDEN: 'Tài khoản không có quyền thực hiện thao tác này.',
    AUTH_ORIGIN_FORBIDDEN: 'Frontend chưa được backend cho phép. Hãy kiểm tra FRONTEND_ORIGIN.',
    OAUTH_STATE_COOKIE_MISMATCH: 'Phiên đăng nhập Google không hợp lệ. Hãy bắt đầu lại.',
    OAUTH_TRANSACTION_INVALID: 'Phiên đăng nhập Google đã hết hạn. Hãy bắt đầu lại.',
    OAUTH_TRANSACTION_ALREADY_USED: 'Mã đăng nhập Google đã được dùng. Hãy bắt đầu lại.',
    OAUTH_CODE_EXCHANGE_FAILED: 'Không thể xác thực với Google. Hãy thử lại.',
    OAUTH_ID_TOKEN_INVALID: 'Google không trả về thông tin xác thực hợp lệ.',
    OAUTH_EMAIL_NOT_VERIFIED: 'Email Google này chưa được xác thực.',
    OAUTH_ACCOUNT_LINK_REQUIRED: 'Email này đã tồn tại với phương thức đăng nhập khác.',
    MFA_CODE_INVALID: 'Mã xác thực không chính xác.',
    MFA_CHALLENGE_INVALID: 'Phiên xác thực hai lớp đã hết hạn. Hãy đăng nhập lại.',
    MFA_CHALLENGE_EXHAUSTED: 'Bạn đã thử quá nhiều mã không hợp lệ. Hãy đăng nhập lại.',
    MFA_ENROLLMENT_TOKEN_INVALID: 'Phiên thiết lập xác thực hai lớp đã hết hạn. Hãy đăng nhập lại.',
    MFA_SETUP_REQUIRED: 'Hãy tạo mã QR trước khi xác nhận thiết lập.',
    PRODUCT_CATEGORY_NOT_FOUND: 'Danh mục đã chọn không còn tồn tại.',
    CATEGORY_NOT_FOUND: 'Danh mục không còn tồn tại.',
    CATEGORY_SLUG_CONFLICT: 'Slug danh mục này đã được sử dụng.',
    CATEGORY_NOT_EMPTY: 'Không thể xóa danh mục đã có sản phẩm. Hãy tạm dừng danh mục thay vì xóa.',
    PRODUCT_SLUG_CONFLICT: 'Slug này đã được sử dụng. Hãy chọn slug khác.',
    PRODUCT_SKU_CONFLICT: 'SKU này đã được sử dụng. Hãy chọn SKU khác.',
    PRODUCT_INVALID_PRICE: 'Giá sản phẩm không hợp lệ.',
    PRODUCT_CANNOT_ACTIVATE: 'Sản phẩm cần danh mục hoạt động và ít nhất một ảnh trước khi kích hoạt.',
    PRODUCT_NOT_FOUND: 'Sản phẩm không còn tồn tại hoặc hiện không được mở bán.',
    CART_ITEM_NOT_FOUND: 'Sản phẩm trong giỏ hàng không còn tồn tại. Dữ liệu đã được làm mới.',
    CART_ITEM_QUANTITY_CONFLICT: 'Số lượng trong giỏ hàng đã thay đổi. Vui lòng kiểm tra lại.',
    ADDRESS_NOT_FOUND: 'Địa chỉ giao hàng không còn tồn tại. Vui lòng chọn lại.',
    ADDRESS_DEFAULT_CONFLICT: 'Địa chỉ mặc định vừa thay đổi. Dữ liệu đã được làm mới.',
    PRODUCT_OUT_OF_STOCK: 'Một hoặc nhiều sản phẩm đã không còn đủ số lượng. Vui lòng kiểm tra lại giỏ hàng.',
    IDEMPOTENCY_KEY_REQUIRED: 'Không thể xác nhận lần đặt hàng này. Vui lòng thử lại.',
    IDEMPOTENCY_KEY_INVALID: 'Phiên đặt hàng không hợp lệ. Vui lòng thử lại.',
    IDEMPOTENCY_KEY_CONFLICT: 'Nội dung giỏ hàng đã thay đổi. Vui lòng xác nhận lại đơn hàng.',
    ORDER_ITEMS_REQUIRED: 'Đơn hàng cần có ít nhất một sản phẩm.',
    ORDER_ITEM_INVALID: 'Thông tin sản phẩm đặt hàng không hợp lệ.',
    CART_ITEM_INVALID: 'Thông tin sản phẩm trong giỏ hàng không hợp lệ.',
    CHECKOUT_RATE_LIMITED: 'Bạn đã thử đặt hàng quá nhiều lần. Vui lòng thử lại sau.',
    ORDER_TOTAL_TOO_LARGE: 'Tổng giá trị đơn hàng vượt quá giới hạn hỗ trợ.',
    PRODUCT_IMAGE_LIMIT_REACHED: 'Sản phẩm đã đạt giới hạn 10 ảnh.',
    PRODUCT_IMAGE_NOT_FOUND: 'Ảnh sản phẩm không còn tồn tại.',
    PRODUCT_ACTIVE_IMAGE_REQUIRED: 'Sản phẩm đang hoạt động phải luôn có ít nhất một ảnh.',
    IMAGE_FILE_REQUIRED: 'Hãy chọn một tệp ảnh.',
    IMAGE_FILE_TOO_LARGE: 'Ảnh phải có dung lượng tối đa 5 MB.',
    IMAGE_UPLOAD_INVALID: 'Tệp ảnh không hợp lệ. Chỉ dùng JPEG, PNG hoặc WebP.',
    OBJECT_STORAGE_UNAVAILABLE: 'Kho lưu trữ ảnh đang tạm thời không khả dụng.',
    INVENTORY_VERSION_CONFLICT: 'Tồn kho đã thay đổi. Dữ liệu đã được làm mới, hãy thử lại.',
    INVENTORY_ADJUSTMENT_INVALID: 'Điều chỉnh này sẽ làm tồn kho thấp hơn lượng đã giữ.',
    ORDER_NOT_FOUND: 'Đơn hàng không còn tồn tại.',
    INVALID_ORDER_TRANSITION: 'Trạng thái đơn hàng đã thay đổi hoặc không thể chuyển theo cách này.',
    ORDER_CANCELLATION_REASON_REQUIRED: 'Cần nhập lý do khi hủy đơn đã xác nhận hoặc đang xử lý.',
    INVENTORY_OPERATION_INVALID: 'Không thể cập nhật tồn kho cho trạng thái đơn hàng này.',
    USER_NOT_FOUND: 'Người dùng không còn tồn tại.',
    LAST_ACTIVE_ADMIN_REQUIRED: 'Hệ thống phải luôn còn ít nhất một quản trị viên đang hoạt động.',
    MFA_RESET_SELF_FORBIDDEN: 'Bạn không thể đặt lại MFA của chính mình tại đây.',
    MFA_RESET_NOT_AVAILABLE: 'Chỉ có thể đặt lại MFA cho Nhân viên hoặc Quản trị viên.',
    VALIDATION_FAILED: 'Dữ liệu nhập vào chưa hợp lệ. Hãy kiểm tra lại.',
    NETWORK_ERROR: 'Không thể kết nối đến máy chủ. Vui lòng thử lại.',
  };

  return messages[error.code] || error.message || 'Không thể hoàn tất yêu cầu. Vui lòng thử lại.';
}
