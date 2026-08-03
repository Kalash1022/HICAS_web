# HICAS Commerce — Thiết kế hệ thống tích hợp

> Trạng thái: **Ready for Lean MVP migrations và implementation** — đã áp dụng đánh giá Lean MVP ngày 2026-07-22  
> Phạm vi MVP: Commerce, Google SSO, email/password và TOTP bắt buộc cho Staff/Admin  
> Đây là nguồn thiết kế duy nhất. Mục ghi “sau MVP” mô tả kiến trúc đích nhưng không được đưa vào migration/API của Lean MVP.

## 1. Mục tiêu

HICAS Commerce gồm hai giao diện sử dụng chung một backend:

- Storefront cho khách hàng: xem sản phẩm, giỏ hàng, checkout và theo dõi đơn.
- Admin portal: quản lý người dùng, sản phẩm, danh mục, tồn kho và đơn hàng.

Mục tiêu kiến trúc:

- Có thể triển khai MVP mà không còn quyết định schema bị bỏ ngỏ.
- Dễ phát triển và debug trong một codebase.
- Bảo vệ nhất quán dữ liệu giá, đơn hàng và tồn kho.
- Hỗ trợ email/password, Google SSO và TOTP MFA.
- Có đường mở rộng nhưng không thiết kế quá mức cho MVP.

## 2. Các quyết định đã chốt

| ID | Quyết định | Lý do |
|---|---|---|
| ADR-001 | Sử dụng modular monolith | Đơn giản vận hành, vẫn giữ ranh giới module rõ ràng |
| ADR-002 | Không dùng `ProductVariant` trong MVP | Giao diện hiện tại chỉ có một SKU, giá và tồn kho cho mỗi sản phẩm |
| ADR-003 | Một Product thuộc đúng một Category | Đơn giản hóa filter, CRUD và schema MVP |
| ADR-004 | Reserve stock khi tạo order | Ngăn oversell trong thời gian chờ admin xác nhận |
| ADR-005 | Commit stock khi order chuyển `CONFIRMED` | Phù hợp luồng COD và tránh chờ đến lúc giao hàng |
| ADR-006 | Order application service điều phối Prisma transaction | Giữ atomicity mà module không truy cập repository của nhau |
| ADR-007 | Google là SSO provider duy nhất | Không xây abstraction cho Facebook/Zalo khi chưa có yêu cầu |
| ADR-008 | Google identity dùng claim `sub` | `sub` là định danh ổn định, email không phải provider key |
| ADR-009 | Lean MVP không có Customer MFA; Staff/Admin bắt buộc MFA | Bảo vệ tài khoản quản trị mà không mở rộng UI/API cho Customer quá sớm |
| ADR-010 | Access token trong memory, refresh token trong HttpOnly cookie | Giảm rủi ro token bị đọc bởi JavaScript |
| ADR-011 | Ảnh lưu ở object storage | PostgreSQL chỉ lưu URL và storage key |
| ADR-012 | Tiền dùng `numeric(14,2)` | Không dùng floating point cho dữ liệu tài chính |
| ADR-013 | Checkout dùng PostgreSQL row-level lock theo thứ tự Product ID | Quy tắc concurrency cụ thể, ngăn oversell và giảm nguy cơ deadlock |
| ADR-014 | Hủy `CONFIRMED`/`PROCESSING` tự động RESTOCK trong cùng transaction | Không để order đã hủy nhưng stock bị thất thoát |
| ADR-015 | Idempotency gồm key và request hash | Phân biệt retry hợp lệ với việc tái sử dụng key cho payload khác |
| ADR-016 | Category có product không được hard delete | Giữ toàn vẹn tham chiếu; ngừng sử dụng bằng `is_active=false` |
| ADR-017 | SKU và slug không được tái sử dụng sau soft delete | Tránh nhầm định danh, URL và dữ liệu lịch sử |
| ADR-018 | MVP dùng ma trận role cố định; audit log chỉ Admin xem | Loại bỏ permission model mơ hồ khỏi MVP |
| ADR-019 | Rate limit in-memory chỉ cho một backend instance | Redis bắt buộc trước khi scale ngang |
| ADR-020 | Staff/Admin chưa có MFA chỉ nhận enrollment token giới hạn | Cho phép hoàn tất enrollment mà không cấp quyền quản trị sớm |
| ADR-021 | Triển khai Lean MVP trước, production hardening ở giai đoạn 2 | Giữ kiến trúc đích nhưng giảm chi phí xây dựng và kiểm thử ban đầu |
| ADR-022 | Email auth dùng lifecycle `PENDING → ACTIVE`; resend thuộc Lean MVP | Không để user bị kẹt vì email thất lạc hoặc token hết hạn |
| ADR-023 | Google OIDC dùng state + PKCE + nonce | Ràng buộc CSRF, authorization code và ID token với đúng login request |
| ADR-024 | Mọi Order transition lock Order trước rồi lock Inventory | Serialize các transition cạnh tranh và giữ stock/order nhất quán |
| ADR-025 | COD chỉ `UNPAID/PAID`; chuyển `PAID` khi Order `COMPLETED` | Chốt lifecycle thanh toán tối giản, không cần mark-paid endpoint |
| ADR-026 | Ảnh Product dùng flow draft-first | Luôn có Product ID trước khi sinh storage key và liên kết ảnh |
| ADR-027 | Guard đọc User + Session mỗi protected request; bảo vệ Admin cuối cùng | Role/status và session revoke có hiệu lực ngay trong hệ thống một instance |
| ADR-028 | Shipping fee MVP là flat fee cấu hình backend | Không để frontend quyết định phí và chưa cần tích hợp hãng vận chuyển |
| ADR-029 | Supabase chỉ là PostgreSQL hạ tầng; Data API không truy cập bảng backend | Mọi authorization đi qua NestJS; migration revoke Data API roles và bật RLS không policy |
| ADR-030 | Google state được bind với browser bằng HttpOnly cookie | DB state chống replay nhưng cookie binding mới ngăn login-CSRF từ authorization response được chuyển sang browser khác |
| ADR-031 | Pending TOTP setup sống tối đa 10 phút và không vượt quá enrollment grant; setup trả `otpauthUri`, PNG data URL 256px và manual key | Đóng contract QR/TTL mà không thêm state hoặc cấu hình dư thừa |
| ADR-032 | Mỗi enrollment sinh 10 recovery code 100-bit; primary login mới hủy challenge MFA cũ chưa dùng | Recovery code đủ entropy để hash SHA-256 an toàn và mỗi user chỉ có một login challenge hiện hành |

### 2.1 Hướng mở rộng sau MVP

Nếu cần size/màu, migration sẽ bổ sung `ProductVariant` và chuyển SKU, price, inventory từ Product xuống Variant. Không tạo bảng variant rỗng trong MVP.

Nếu cần nhiều danh mục, migration sẽ chuyển `products.category_id` sang bảng nối `product_categories`. API public vẫn giữ contract tương thích trong giai đoạn chuyển đổi.

### 2.2 Lean MVP và kiến trúc đích

| Năng lực | Lean MVP triển khai ngay | Giai đoạn 2 / kiến trúc đích |
|---|---|---|
| MFA | Chỉ Staff/Admin; setup, verify và recovery codes ban đầu | Customer MFA, disable và regenerate recovery codes |
| Email | Verify/resend email, forgot/reset password | Đổi email |
| Session | Refresh rotation, reuse detection và logout hiện tại | Logout-all, danh sách/xóa từng session, UI thiết bị |
| Google | Login; email trùng identity chưa link thì từ chối an toàn | Link/unlink Google account |
| Checkout idempotency | Key + request hash trả lại Order hiện có | Response snapshot tổng quát nếu có nhu cầu |
| Search | Parameterized `ILIKE` trên name/SKU | `pg_trgm`, `unaccent`, ranking/full-text search |
| Audit | Chỉ các security/business event quan trọng | Theo dõi chi tiết, monitoring và phân tích nâng cao |
| Background work | Một cleanup scheduler trong application | Worker/queue chuyên biệt khi tải yêu cầu |
| Deployment | Một backend instance, rate limit in-memory | Redis rate limit, metrics/alert và horizontal scaling |

## 3. Phạm vi MVP

### 3.1 Storefront

- Đăng ký và đăng nhập email/password.
- Đăng nhập Google.
- Quản lý hồ sơ và địa chỉ giao hàng.
- Xem, tìm kiếm, lọc và phân trang sản phẩm.
- Xem chi tiết sản phẩm.
- Quản lý giỏ hàng.
- Checkout bằng COD.
- Xem và hủy đơn khi trạng thái cho phép.

### 3.2 Admin portal

- Đăng nhập email/password hoặc Google.
- MFA bắt buộc với Staff và Admin.
- Xem user, khóa/mở tài khoản, gán role và reset MFA có kiểm soát.
- Quản lý category.
- Quản lý product, ảnh và inventory.
- Quản lý order và state transition.
- Admin xem audit log; Staff không có quyền này trong MVP.

### 3.3 Ngoài phạm vi MVP

- Facebook Login và Zalo Login.
- Product variant.
- Sản phẩm thuộc nhiều category.
- Online payment.
- Marketplace nhiều người bán.
- Promotion engine phức tạp.
- Loyalty point, recommendation, đa kho và đa tiền tệ.
- Customer MFA, disable MFA và recovery-code regeneration.
- Email change.
- Session/device management: logout-all, liệt kê và revoke từng session.
- Google account link/unlink.
- Search tiếng Việt nâng cao (`pg_trgm`, `unaccent`, ranking, full-text).
- Redis rate limit, multi-instance, metrics/alert và secret rotation.

### 3.4 Giả định triển khai Lean MVP

- Mục tiêu là website bán hàng nhỏ đến vừa, vài trăm đến vài nghìn Product và một backend instance.
- PostgreSQL và object storage là dịch vụ dùng chung; không có microservice, queue hoặc distributed worker.
- Khi cần nhiều backend instance hoặc tải tìm kiếm tăng rõ rệt, phải hoàn tất các gate giai đoạn 2 tương ứng trước khi scale.
- Marketplace nhiều người bán vẫn ngoài kiến trúc đích hiện tại, không chỉ ngoài MVP.

Các lớp bảo vệ cốt lõi không được chuyển sang giai đoạn 2: server-side pricing, transaction checkout, row lock theo thứ tự ổn định, Order/Address snapshot, ownership/role authorization, kiểm tra User/Session trong guard, Argon2id, refresh rotation, DTO validation và audit thao tác inventory/order.

## 4. Kiến trúc tổng thể

```text
React Frontend
      │
      │ HTTPS + JSON
      ▼
Reverse Proxy
      │
      ▼
NestJS Modular Monolith
├── Auth & IAM
├── Users & Addresses
├── Catalog
├── Inventory
├── Cart
├── Order
├── Upload
├── Notification/Mail
├── Audit
└── Administration
      │
      ├── PostgreSQL
      ├── S3-compatible object storage
      ├── SMTP hoặc transactional mail provider
      └── Google OpenID Connect
```

### 4.1 Công nghệ

| Thành phần | Lựa chọn |
|---|---|
| Frontend | React + React Router |
| Backend | NestJS + TypeScript |
| Database | PostgreSQL |
| ORM | Prisma |
| Authentication | JWT access token + opaque rotating refresh token |
| Password hashing | Argon2id |
| Google Login | OAuth 2.0 Authorization Code + PKCE S256 |
| Google token verification | `google-auth-library` |
| MFA | RFC 6238 TOTP |
| Object storage | S3-compatible storage |
| Validation | DTO + `class-validator` |
| Logging | Pino structured JSON |
| API documentation | Swagger/OpenAPI |
| Test | Jest/Vitest + Supertest |
| Local infrastructure | Docker Compose |

## 5. Ranh giới module

### Auth

- Register, login, logout và refresh session.
- Google OAuth login; account linking thuộc giai đoạn 2.
- Password credential.
- TOTP setup, challenge và recovery codes cho Staff/Admin.
- Không quản lý dữ liệu commerce.

### Users

- Hồ sơ, role, status và địa chỉ.
- Không phát hành token.
- Không xóa cứng user đã có order.

### Catalog

- Category, Product và ProductImage.
- Product status và public listing.
- Không trực tiếp cập nhật inventory.

### Inventory

- Quantity, reserved quantity và transaction history.
- Cung cấp `reserve`, `release`, `commit`, `restock` và `adjust` qua service contract.
- Không tự tạo hoặc thay đổi order.

### Cart

- Một active cart cho mỗi user.
- Cart item lưu product và quantity.
- Không coi giá trong cart là nguồn sự thật.

### Order

- Snapshot giá, sản phẩm và địa chỉ.
- State machine và cancellation policy.
- Application service điều phối Order và Inventory trong một transaction.

### Upload

- Validate và upload ảnh.
- Trả URL cùng storage key.
- Cleanup object không được liên kết.
- Là internal service được Product/User module gọi; Lean MVP không expose generic upload controller.

### Notification/Mail

- Gửi email xác minh và đặt lại mật khẩu.
- Nhận template data từ module Auth; không tự thay đổi token hoặc trạng thái user.
- Provider được chọn bằng cấu hình, để có thể dùng SMTP trong MVP và thay transactional provider sau này.

### Audit

- `security_events` dành cho authentication/security.
- `audit_logs` dành cho thao tác quản trị dữ liệu nghiệp vụ.
- Lean MVP chỉ ghi các event quan trọng được liệt kê tại mục 8.

## 6. Cấu trúc source code đề xuất

```text
backend/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   ├── common/
│   │   ├── decorators/
│   │   ├── exceptions/
│   │   ├── filters/
│   │   ├── guards/
│   │   ├── interceptors/
│   │   └── pagination/
│   ├── database/
│   ├── auth/
│   ├── users/
│   ├── addresses/
│   ├── categories/
│   ├── products/
│   ├── inventory/
│   ├── carts/
│   ├── orders/
│   ├── uploads/
│   ├── notifications/
│   ├── audit/
│   └── administration/
├── test/
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

Quy ước module:

- Controller chỉ chuyển đổi HTTP request/response.
- Service xử lý nghiệp vụ.
- Repository truy cập Prisma.
- DTO validation và mô tả OpenAPI.
- Module khác chỉ gọi public service contract, không import repository nội bộ.

## 7. Mô hình dữ liệu tổng thể

```text
User 1 ─── 0..1 PasswordCredential
User 1 ─── * AuthIdentity
User 1 ─── * Session
User 1 ─── 0..1 MfaTotpMethod
User 1 ─── * Address
User 1 ─── 1 Cart ─── * CartItem * ─── 1 Product
Category 1 ─── * Product
Product 1 ─── * ProductImage
Product 1 ─── 1 Inventory
Product 1 ─── * InventoryTransaction
User 1 ─── * Order ─── * OrderItem
Order 1 ─── * OrderStatusHistory
```

### 7.1 Quy ước database

- UUID cho primary key.
- `timestamptz` và lưu UTC.
- `numeric(14,2)` cho tiền.
- Snake case trong PostgreSQL, camelCase trong TypeScript.
- Unique constraint là lớp bảo vệ cuối cùng.
- Product dùng soft delete; dữ liệu order snapshot không bị thay đổi.
- Các schema dưới đây là schema của Lean MVP. Trường/bảng dành riêng cho năng lực “giai đoạn 2” chỉ được thêm bằng migration sau khi năng lực đó được duyệt triển khai.

### 7.2 Database check constraints bắt buộc

Initial migration phải tạo named PostgreSQL `CHECK` constraints; DTO/service validation không thay thế các ràng buộc này:

```sql
-- products
CONSTRAINT products_price_nonnegative_ck
  CHECK (price >= 0)
CONSTRAINT products_compare_price_ck
  CHECK (compare_at_price IS NULL OR compare_at_price >= price)

-- inventory
CONSTRAINT inventory_quantity_nonnegative_ck
  CHECK (quantity >= 0)
CONSTRAINT inventory_reserved_nonnegative_ck
  CHECK (reserved_quantity >= 0)
CONSTRAINT inventory_reserved_lte_quantity_ck
  CHECK (reserved_quantity <= quantity)

-- cart_items
CONSTRAINT cart_items_quantity_positive_ck
  CHECK (quantity > 0)

-- order_items
CONSTRAINT order_items_quantity_positive_ck
  CHECK (quantity > 0)
CONSTRAINT order_items_unit_price_nonnegative_ck
  CHECK (unit_price >= 0)
CONSTRAINT order_items_line_total_nonnegative_ck
  CHECK (line_total >= 0)
CONSTRAINT order_items_line_total_formula_ck
  CHECK (line_total = unit_price * quantity)

-- orders
CONSTRAINT orders_subtotal_nonnegative_ck
  CHECK (subtotal >= 0)
CONSTRAINT orders_shipping_fee_nonnegative_ck
  CHECK (shipping_fee >= 0)
CONSTRAINT orders_discount_nonnegative_ck
  CHECK (discount_amount >= 0)
CONSTRAINT orders_discount_lte_subtotal_ck
  CHECK (discount_amount <= subtotal)
CONSTRAINT orders_total_formula_ck
  CHECK (total_amount = subtotal + shipping_fee - discount_amount)
CONSTRAINT orders_cod_payment_lifecycle_ck
  CHECK (
  (payment_status = 'PAID' AND status = 'COMPLETED' AND paid_at IS NOT NULL)
  OR
  (payment_status = 'UNPAID' AND status <> 'COMPLETED' AND paid_at IS NULL)
  )
```

### 7.3 Index và stable pagination

Initial migration tạo tối thiểu các index sau; tên có thể theo convention của Prisma nhưng column order phải được giữ:

```text
users(role, status, id)
addresses(user_id)
products(category_id, status, deleted_at)
products(status, deleted_at, created_at DESC, id DESC)
product_images(product_id, sort_order)
orders(user_id, created_at DESC, id DESC)
orders(status, created_at DESC, id DESC)
order_items(order_id)
order_status_history(order_id, created_at DESC, id DESC)
inventory_transactions(product_id, created_at DESC, id DESC)
sessions(user_id, revoked_at)
sessions(expires_at)
verification_tokens(expires_at)
mfa_challenges(expires_at)
mfa_enrollment_grants(expires_at)
mfa_totp_methods(setup_expires_at)
oauth_transactions(expires_at)
audit_logs(created_at DESC, id DESC)
```

Mọi list API mặc định `ORDER BY created_at DESC, id DESC`; nếu cho phép sort field khác thì luôn thêm `id` làm tie-breaker cuối. Query và cursor/offset pagination phải dùng cùng ordering để không lặp hoặc bỏ record giữa hai trang trong điều kiện dữ liệu không đổi.

## 8. IAM, security và audit data model

### `users`

```text
id
email
email_normalized          unique
full_name
phone                     nullable
avatar_url                nullable
birth_date                nullable
role                      CUSTOMER | STAFF | ADMIN
status                    ACTIVE | BLOCKED | PENDING
email_verified_at         nullable
last_login_at             nullable
created_at
updated_at
```

User status policy:

- Email/password registration tạo `status=PENDING`, `email_verified_at=NULL`; không phát hành application session.
- Verify email consume token atomically, đặt `email_verified_at=now()` và chuyển `PENDING → ACTIVE`; không bao giờ tự chuyển `BLOCKED → ACTIVE`.
- Google Login chỉ chấp nhận claim `email_verified=true`; user mới được tạo `ACTIVE` và đặt `email_verified_at=now()` ngay.
- `PENDING` không login/refresh/protected API và trả `AUTH_EMAIL_NOT_VERIFIED` sau primary credential hợp lệ.
- `BLOCKED` không password/Google login, không refresh và không gọi protected API; trả `AUTH_ACCOUNT_BLOCKED`. Block user, revoke toàn bộ session/enrollment grant và xóa challenge chưa dùng nằm trong cùng transaction. Mọi MFA/enrollment endpoint kiểm tra lại status/role trước khi tạo session.
- Unblock chuyển về `ACTIVE` nếu `email_verified_at` có giá trị, nếu không thì về `PENDING`.

### `password_credentials`

```text
id
user_id                   unique, FK users
password_hash
password_changed_at
created_at
updated_at
```

User Google-only không có record này.

### `auth_identities`

```text
id
user_id                   FK users
provider                  GOOGLE
provider_account_id       Google sub
provider_email
created_at
updated_at

UNIQUE(provider, provider_account_id)
```

### `oauth_transactions`

```text
id
state_hash                unique
nonce_hash                unique
pkce_verifier_encrypted
redirect_uri
expires_at
consumed_at               nullable
created_at
```

### `sessions`

```text
id
user_id
refresh_token_hash        unique
token_family_id
expires_at
revoked_at                nullable
replaced_by_session_id    nullable
ip_address                nullable
user_agent                nullable
created_at
last_used_at
```

### `mfa_totp_methods`

```text
id
user_id                   unique
secret_encrypted
status                    PENDING | ENABLED
setup_expires_at          nullable
enabled_at                nullable
last_used_time_step       nullable
created_at
updated_at
```

### `mfa_challenges`

```text
id
user_id
token_hash                unique
primary_method            PASSWORD | GOOGLE
attempt_count
max_attempts
expires_at
consumed_at               nullable
ip_address                nullable
created_at
```

### `mfa_enrollment_grants`

```text
id
user_id
token_hash                unique
primary_method            PASSWORD | GOOGLE
expires_at
consumed_at               nullable
revoked_at                nullable
created_at
```

Grant này chỉ được tạo sau khi primary authentication thành công cho Staff/Admin chưa có MFA. Token gốc là opaque random token, chỉ trả một lần; database chỉ lưu hash. Grant không phải session và không mang role permission. Trước khi tạo grant mới, backend đặt `revoked_at` cho mọi grant cũ chưa consume/revoke của user.

### `mfa_recovery_codes`

```text
id
user_id
code_hash
used_at                   nullable
created_at
```

### `verification_tokens`

```text
id
user_id
type                      EMAIL_VERIFICATION | PASSWORD_RESET
token_hash                unique
expires_at
used_at                   nullable
created_at
```

### `security_events`

```text
id
user_id                   nullable
type
ip_address                nullable
user_agent                nullable
metadata                  jsonb
created_at
```

Không lưu password, Google code/token, access/refresh token, OTP hoặc TOTP secret trong log/event.

### `audit_logs`

```text
id
actor_id                  nullable, FK users
action
entity_type
entity_id
before_data               jsonb, nullable
after_data                jsonb, nullable
ip_address                nullable
request_id                nullable
created_at
```

`audit_logs` là append-only. Ứng dụng không cung cấp API sửa/xóa log. `before_data` và `after_data` chỉ chứa trường nghiệp vụ cần truy vết, tuyệt đối không chứa password hash, cookie, token, Google code, OTP, MFA secret hoặc recovery code.

Lean MVP chỉ bắt buộc ghi các event quan trọng:

```text
SecurityEvent: LOGIN_FAILED | PASSWORD_RESET | MFA_CHANGED | MFA_RECOVERY_CODE_USED
               MFA_RESET_BY_ADMIN
AuditLog: PRODUCT_CREATED | PRODUCT_UPDATED | INVENTORY_ADJUSTED
          ORDER_STATUS_CHANGED | USER_BLOCKED | USER_UNBLOCKED | USER_ROLE_CHANGED
          USER_MFA_RESET
```

Không audit mọi lần đọc hoặc mọi thay đổi trình bày nhỏ. Thao tác tồn kho, trạng thái đơn, khóa/mở user và thay đổi dữ liệu bán hàng quan trọng không được bỏ audit.

## 9. Google SSO

### 9.1 Login sequence

```text
Frontend                 Backend                    Google
   │                        │                          │
   ├─ GET /google/url ─────►│                          │
   │                        ├─ state + PKCE + nonce     │
   │◄─ authorizationUrl ────┤                          │
   ├──────── redirect ────────────────────────────────►│
   │◄──────── code + state ────────────────────────────┤
   ├─ POST code,state ─────►│                          │
   │                        ├─ exchange code ─────────►│
   │                        │◄─ Google ID token ───────┤
   │                        ├─ verify + user lookup     │
   │◄─ session/MFA/enroll ──┤                          │
```

### 9.2 Authorization URL

```http
GET /api/v1/auth/google/url
```

Backend tạo state và nonce độc lập, mỗi giá trị random tối thiểu 32 bytes, PKCE S256 và OAuth transaction TTL 10 phút. Database lưu hash của state/nonce; PKCE verifier được mã hóa bằng application encryption service với `OAUTH_TRANSACTION_ENCRYPTION_KEY`.

Response trả `{ authorizationUrl, expiresIn: 600 }` và đặt cookie
`hicas_google_oauth_state` chứa state gốc, `HttpOnly`, `SameSite=Lax`, path
`/api/v1/auth/google/callback`, TTL 10 phút và `Secure=true` ở production.
Frontend bắt buộc gọi endpoint bằng `credentials: "include"`; có thể giữ thêm
state trong `sessionStorage` để kiểm tra trước callback nhưng không thay thế
HttpOnly cookie phía backend. Endpoint này cũng kiểm tra `Origin`/`Referer` exact
match trước khi tạo transaction để tránh cross-site prefetch/overwrite cookie.

```text
response_type=code
scope=openid email profile
state=<random-state>
nonce=<random-nonce>
code_challenge=<S256-challenge>
code_challenge_method=S256
redirect_uri=<GOOGLE_REDIRECT_URI>
```

Không yêu cầu offline access và không lưu Google refresh token trong MVP.

Vai trò tách biệt: `state` bảo vệ callback khỏi CSRF/mix-up, PKCE ràng buộc authorization code với request khởi tạo, còn `nonce` ràng buộc ID token với đúng OAuth transaction. Không bỏ một cơ chế vì đã có hai cơ chế còn lại.

### 9.3 Callback

```http
POST /api/v1/auth/google/callback

{
  "code": "google-authorization-code",
  "state": "oauth-state"
}
```

Backend:

1. Kiểm tra `Origin`/`Referer`, constant-time compare body state với browser state
   cookie và xóa cookie sau callback.
2. Hash và tìm state.
3. Kiểm tra TTL và `consumed_at`.
4. Consume transaction atomically.
5. Giải mã PKCE verifier và đổi code.
6. Verify Google ID token bằng `google-auth-library`.
7. Kiểm tra signature, `aud`, `iss`, `exp`, `sub`, `email_verified=true` và email policy.
8. Hash claim `nonce` từ ID token và constant-time compare với `oauth_transactions.nonce_hash`; thiếu/sai nonce trả `OAUTH_NONCE_INVALID`.
9. Tìm identity bằng `(GOOGLE, sub)`.
10. Tạo user/identity `ACTIVE` mới với `email_verified_at=now()` nếu email chưa tồn tại.
11. Nếu email trùng user chưa linked, trả `OAUTH_ACCOUNT_LINK_REQUIRED`.
12. Yêu cầu user `ACTIVE`; `PENDING/BLOCKED` trả error tương ứng, nếu hợp lệ mới áp dụng policy MFA/session theo role.

`redirect_uri` không nhận từ frontend; backend dùng giá trị cấu hình cố định và
config validation yêu cầu origin của URI này nằm trong `FRONTEND_ORIGIN`. PKCE
verifier dùng envelope AES-256-GCM versioned, IV ngẫu nhiên 12 byte, auth tag 16
byte và AAD bind ciphertext với hash state của đúng transaction.

Callback là one-time, không replay response: bước 3 atomically claim transaction bằng `consumed_at`; request lặp/cạnh tranh trả `OAUTH_TRANSACTION_ALREADY_USED` và không exchange code hay tạo session lần hai. Nếu exchange/Google verification lỗi sau khi claim, frontend phải bắt đầu authorization flow mới. Unique identity/user constraints vẫn bảo đảm không tạo account trùng; Lean MVP không lưu callback response snapshot.

### 9.4 Account linking — giai đoạn 2

- Lean MVP chưa có link/unlink API hoặc UI. Khi Google email trùng user chưa linked, trả `OAUTH_ACCOUNT_LINK_REQUIRED` và hướng dẫn user đăng nhập bằng phương thức hiện có.
- Giai đoạn 2 bổ sung flow linking yêu cầu access token, đồng thời thêm `purpose=ACCOUNT_LINK` và `initiated_by_user_id` vào OAuth transaction.
- Không auto-link chỉ dựa trên email.
- Không cho unlink nếu Google là phương thức đăng nhập duy nhất.
- Unlink yêu cầu recent reauthentication.

## 10. Session và token

### Access token

- JWT sống 15 phút.
- Frontend giữ trong memory.
- Payload gồm `sub`, `sid`, `role`, `type=access`.
- `role` trong JWT chỉ là hint; không phải nguồn authorization cuối cùng.

Với quy mô Lean MVP, mọi protected request sau khi verify JWT phải đọc `users` và `sessions` bằng `sub` + `sid`: user phải `ACTIVE`, session chưa revoke/chưa hết hạn, và service/guard dùng role hiện tại từ database. Vì vậy block, đổi role, password reset, MFA reset hoặc logout có hiệu lực ngay với access token đã phát hành. Giai đoạn 2 có thể dùng `auth_version`/cache nếu phép đo cho thấy database lookup này là bottleneck.

### Refresh token

- Opaque random token sống 14 ngày.
- Cookie `HttpOnly`, `Secure` ở production, `SameSite=Lax`.
- Database chỉ lưu hash.
- Rotate mỗi lần refresh.
- Reuse token cũ làm revoke toàn bộ token family.

```http
POST /api/v1/auth/refresh
POST /api/v1/auth/logout
```

Backend vẫn revoke cả token family nội bộ khi phát hiện reuse, reset password, block user hoặc đổi role. Public API `logout-all`, danh sách/revoke từng session và UI quản lý thiết bị thuộc giai đoạn 2.

## 11. TOTP MFA

### Chính sách

- RFC 6238, 6 chữ số, chu kỳ 30 giây.
- Chấp nhận tối đa `±1` time step.
- Không chấp nhận lại time step đã dùng thành công.
- Challenge TTL 5 phút và tối đa 5 lần thử.
- Secret được mã hóa bằng application encryption key.
- Recovery code chỉ lưu hash và dùng một lần.
- Lean MVP không cho Customer bật MFA; Staff/Admin bắt buộc MFA.
- Việc chống replay phải atomic: sau khi OTP hợp lệ về mặt mật mã, cập nhật `last_used_time_step` bằng điều kiện `last_used_time_step IS NULL OR last_used_time_step < candidate_time_step`; chỉ xác thực thành công khi đúng một row được cập nhật.
- Mọi `enable`, `verify`, Admin reset, block hoặc role-change có thay đổi MFA đều lock User row bằng `SELECT ... FOR UPDATE` trước, rồi mới lock/đọc method, challenge, grant và session theo cùng thứ tự. Ngay trước khi insert session, `verify/enable` phải recheck User `ACTIVE`, role vẫn yêu cầu MFA, method còn `ENABLED` và challenge/grant chưa bị consume/revoke.

### Enrollment bắt buộc cho Staff/Admin

Sau primary authentication, nếu role là Staff/Admin nhưng chưa có `mfa_totp_methods.status=ENABLED`, backend không tạo application session và không trả access/refresh token. Backend trả grant giới hạn:

```json
{
  "data": {
    "mfaEnrollmentRequired": true,
    "enrollmentToken": "opaque-single-purpose-token",
    "expiresIn": 600
  }
}
```

`enrollmentToken` chỉ được phép gọi:

```http
POST /api/v1/auth/mfa/setup
POST /api/v1/auth/mfa/enable
```

- Hai endpoint nhận enrollment token qua `Authorization: Bearer <token>`; token này không vượt qua application auth guard thông thường.
- Trong enrollment flow, bật method, lưu recovery-code hashes, consume grant và tạo full session nằm trong cùng database transaction. Cookie chỉ được ghi sau khi transaction commit; nếu bất kỳ bước nào lỗi thì không có method/session nửa chừng.
- Grant hết hạn, đã consume hoặc bị revoke không thể dùng lại.
- Khi Customer được nâng role thành Staff, backend revoke toàn bộ session hiện có trong cùng nghiệp vụ đổi role. Lần đăng nhập tiếp theo bắt buộc enrollment; không có Staff permission trước khi MFA được bật.
- Staff/Admin không được disable MFA khi vẫn giữ role yêu cầu MFA.
- Khi hạ role Staff/Admin xuống Customer, cùng transaction phải đổi role, revoke mọi session và enrollment grant, xóa challenge chưa dùng, TOTP method cùng recovery codes, rồi ghi `MFA_CHANGED` + `USER_ROLE_CHANGED`. Hạ Admin xuống Staff vẫn giữ MFA vì role mới tiếp tục yêu cầu MFA.

### Setup

```http
POST /api/v1/auth/mfa/setup
```

Backend sinh pending secret, QR `otpauth://` và manual key. MFA chưa được bật ở bước này.

### Enable

```http
POST /api/v1/auth/mfa/enable

{
  "code": "123456"
}
```

Chỉ bật sau khi xác minh mã đầu tiên. Backend sinh 10 recovery codes và chỉ trả một lần.

### Login challenge

Sau primary authentication:

```json
{
  "data": {
    "mfaRequired": true,
    "mfaToken": "opaque-single-purpose-token",
    "expiresIn": 300
  }
}
```

```http
POST /api/v1/auth/mfa/verify

{
  "mfaToken": "challenge-token",
  "code": "123456"
}
```

Request phải có đúng một trong hai field `code` hoặc `recoveryCode`:

```json
{
  "mfaToken": "challenge-token",
  "recoveryCode": "one-time-recovery-code"
}
```

`mfaToken` không phải access token. Với recovery code, backend so hash và consume atomically bằng điều kiện `used_at IS NULL`; chỉ đúng một request được thành công. Consume challenge, đánh dấu recovery code, tạo session và ghi `MFA_RECOVERY_CODE_USED` nằm trong cùng transaction. Event không chứa recovery code. Session chỉ được tạo sau TOTP hoặc recovery code hợp lệ.

### Mất thiết bị MFA

```http
POST /api/v1/admin/users/:id/mfa/reset
```

- Chỉ Admin được gọi cho target Staff/Admin khác; không cho tự reset MFA bằng endpoint này.
- Trong một transaction: lock target User, revoke sessions/enrollment grants, xóa challenge chưa dùng, TOTP method và recovery codes, rồi ghi `MFA_RESET_BY_ADMIN` cùng `USER_MFA_RESET`.
- Target không còn application session và phải thực hiện enrollment ở lần primary login tiếp theo.
- Nếu hệ thống chỉ còn một Admin và người đó mất cả Authenticator/recovery codes, dùng runbook mục 21.1. Không tạo public bypass API cho trường hợp này.

### Customer MFA và quản lý nâng cao — giai đoạn 2

Lean MVP không expose MFA status/disable hoặc recovery-code regeneration. Staff/Admin không thể disable MFA khi còn giữ role yêu cầu MFA. Customer self-enrollment, recent reauthentication, disable và regenerate recovery codes chỉ được thiết kế API khi bước sang giai đoạn 2; initial recovery codes cho Staff/Admin vẫn được sinh một lần lúc enable.

## 12. Commerce data model

### `addresses`

```text
id
user_id                   FK users
recipient_name
phone
province
district
ward
street
postal_code               nullable
is_default
created_at
updated_at
```

- Mọi thao tác đọc/sửa/xóa phải kiểm tra `user_id` ownership tại service.
- Mỗi user có tối đa một địa chỉ mặc định bằng partial unique index trên `user_id WHERE is_default=true`.
- Đặt một địa chỉ làm mặc định phải bỏ cờ mặc định cũ và bật cờ mới trong cùng transaction.
- Order chỉ lưu `shipping_snapshot`; sửa hoặc xóa Address không thay đổi order lịch sử.

```sql
CREATE UNIQUE INDEX addresses_one_default_per_user
ON addresses (user_id)
WHERE is_default = true;
```

### `categories`

```text
id
name
slug                      unique
description               nullable
sort_order
is_active
created_at
updated_at
```

MVP không hỗ trợ category tree. `parent_id` chỉ được bổ sung khi có nghiệp vụ danh mục nhiều cấp.

Chính sách vòng đời Category:

- `is_active=false` là cách ngừng sử dụng Category; Category và các Product thuộc nó không xuất hiện ở catalog public.
- `DELETE` chỉ được hard delete Category chưa từng có Product tham chiếu.
- Nếu Category đang hoặc đã có Product tham chiếu, từ chối với `CATEGORY_NOT_EMPTY`; không cascade và không tự chuyển Product sang Category khác.

### `products`

```text
id
category_id               FK categories
name
slug                      unique
sku                       unique
description               nullable
price                     numeric(14,2)
compare_at_price          nullable
status                    DRAFT | ACTIVE | ARCHIVED
created_by                FK users
deleted_at                nullable
created_at
updated_at
```

Chính sách vòng đời Product:

- `DRAFT`: chưa bán và không xuất hiện public.
- `ACTIVE`: được bán khi Category cũng active và chưa soft delete.
- `ARCHIVED`: ngừng bán nhưng vẫn xuất hiện trong truy vấn Admin thông thường.
- `deleted_at IS NOT NULL`: soft-deleted và bị loại khỏi các truy vấn business/Admin thông thường; chỉ truy vấn vận hành chuyên biệt mới được phép lấy.
- `DELETE /api/v1/admin/products/:id` chỉ đặt `deleted_at`; Product không bị hard delete trong luồng ứng dụng.
- Catalog public luôn áp dụng đồng thời `status=ACTIVE`, `deleted_at IS NULL` và `category.is_active=true`.
- SKU và slug không được tái sử dụng sau soft delete trong MVP. Unique constraint không phải partial index và tiếp tục giữ định danh đã dùng.

Search Lean MVP dùng parameterized `ILIKE '%keyword%'` trên `name` và `sku`, escape `%`, `_` do user nhập, giới hạn `limit` và luôn áp dụng visibility filter. Cách này phù hợp vài trăm đến vài nghìn Product. `pg_trgm`, `unaccent`, ranking và full-text search trên description thuộc giai đoạn 2, chỉ thêm sau khi đo query thực tế cho thấy cần thiết.

### `product_images`

```text
id
product_id
url
storage_key
alt_text                  nullable
sort_order
is_primary
created_at
```

Tối đa một primary image cho mỗi product, được bảo vệ bằng partial unique index.

### `inventory`

```text
product_id                PK, FK products
quantity                  >= 0
reserved_quantity         >= 0
version                   optimistic locking
updated_at
```

`version` dùng cho adjustment từ Admin theo optimistic locking và để dành cho mở rộng. Checkout không dựa vào `version`; checkout dùng row-level lock như mục 14.

Invariant:

```text
0 <= reserved_quantity <= quantity
available = quantity - reserved_quantity
```

### `inventory_transactions`

```text
id
product_id
order_id                  nullable
type                      IMPORT | ADJUST | RESERVE | RELEASE | COMMIT | RESTOCK
quantity_delta
reserved_delta
quantity_after
reserved_after
reason
created_by                nullable
created_at
```

Đây là append-only audit trail.

### `carts`

```text
id
user_id                   unique
created_at
updated_at
```

### `cart_items`

```text
id
cart_id
product_id
quantity                  > 0
created_at
updated_at

UNIQUE(cart_id, product_id)
```

Cart không lưu giá làm nguồn sự thật.

### `orders`

```text
id
order_number              unique
user_id
status                    PENDING | CONFIRMED | PROCESSING | SHIPPING | COMPLETED | CANCELLED
payment_method            COD
payment_status            UNPAID | PAID
paid_at                   nullable
subtotal                  numeric(14,2)
shipping_fee              numeric(14,2)
discount_amount           numeric(14,2)
total_amount              numeric(14,2)
currency                  VND
shipping_snapshot         jsonb
customer_note             nullable
idempotency_key
idempotency_request_hash  SHA-256 của canonical checkout request
created_at
updated_at

UNIQUE(user_id, idempotency_key)
```

`shipping_snapshot` có shape cố định:

```json
{
  "recipientName": "Nguyễn Văn A",
  "phone": "0900000000",
  "province": "Hà Nội",
  "district": "Hai Bà Trưng",
  "ward": "Bách Khoa",
  "street": "Số 1 Đại Cồ Việt",
  "postalCode": null
}
```

Checkout chỉ nhận `addressId`. Backend kiểm tra Address thuộc authenticated user và dựng snapshot từ row trong database; không nhận arbitrary shipping JSON từ frontend. Snapshot bất biến sau khi Order được tạo.

Lean MVP dùng flat fee `DEFAULT_SHIPPING_FEE_VND` từ backend config, mặc định thiết kế là `30000`; config phải là số nguyên không âm. Promotion ngoài phạm vi nên `discount_amount=0`, `total_amount=subtotal+shipping_fee`. Frontend không được gửi hoặc override shipping fee.

### `order_items`

```text
id
order_id
product_id                nullable
product_name
product_sku
product_image_url         nullable
unit_price                numeric(14,2)
quantity
line_total                numeric(14,2)
```

Product data và giá được snapshot tại thời điểm đặt hàng.

### `order_status_history`

```text
id
order_id
from_status               nullable
to_status
changed_by                nullable
note                      nullable
created_at
```

## 13. Luồng tồn kho COD đã chốt

### Tạo order

```text
reserved_quantity += ordered_quantity
InventoryTransaction = RESERVE
```

### Admin xác nhận order

```text
quantity -= ordered_quantity
reserved_quantity -= ordered_quantity
InventoryTransaction = COMMIT
Order: PENDING → CONFIRMED
```

### Hủy khi còn PENDING

```text
reserved_quantity -= ordered_quantity
InventoryTransaction = RELEASE
Order: PENDING → CANCELLED
```

### Hủy sau CONFIRMED

Staff/Admin có thể hủy order ở `CONFIRMED` hoặc `PROCESSING` với lý do bắt buộc. Hệ thống tự nhập lại toàn bộ số lượng đã commit:

```text
quantity += ordered_quantity
InventoryTransaction = RESTOCK
Order: CONFIRMED | PROCESSING → CANCELLED
```

Trong cùng một database transaction phải cập nhật Order, thêm một `RESTOCK` cho mỗi OrderItem, thêm `OrderStatusHistory` và thêm `AuditLog`. Nếu bất kỳ bước nào thất bại, toàn bộ thao tác rollback. Order ở `SHIPPING` hoặc `COMPLETED` không được hủy trong MVP.

Customer chỉ được tự hủy order `PENDING`; Staff/Admin mới được hủy `CONFIRMED` hoặc `PROCESSING`.

## 14. Checkout transaction

Order application service mở một `prisma.$transaction` và truyền `Prisma.TransactionClient` qua các service contract.

```text
OrderApplicationService
├── OrderService.createPending(tx, ...)
├── InventoryService.reserve(tx, ...)
├── CartService.removeCheckedOutItems(tx, ...)
└── OrderStatusHistoryService.append(tx, ...)
```

Các bước:

1. Yêu cầu `Idempotency-Key`, chuẩn hóa checkout payload thành canonical JSON và tính SHA-256 `idempotency_request_hash`.
2. Đọc Address bằng `addressId`, kiểm tra ownership và tạo `shipping_snapshot` trong transaction.
3. Sort Product ID để thống nhất thứ tự lock.
4. Lock inventory bằng `SELECT ... FOR UPDATE` theo thứ tự Product ID đã sort. Prisma implementation dùng parameterized `$queryRaw`; không ghép chuỗi ID vào SQL.
5. Đọc lại Product status và price.
6. Kiểm tra available stock.
7. Server tính subtotal, flat shipping fee và total.
8. Tạo Order/OrderItem/Address snapshot với `payment_method=COD`, `payment_status=UNPAID`.
9. Reserve inventory.
10. Xóa cart items tương ứng.
11. Commit transaction.

Frontend không được quyết định `unitPrice`, `subtotal` hoặc `total`.

SQL tương đương của bước lock:

```sql
SELECT product_id, quantity, reserved_quantity
FROM inventory
WHERE product_id = ANY($1::uuid[])
ORDER BY product_id
FOR UPDATE;
```

Quy tắc idempotency:

- Cùng user + cùng key + cùng request hash: đọc và trả representation hiện tại của Order đã có (`200 OK`), không reserve lần nữa. `orders.id` chính là resource mapping của idempotency key; MVP không lưu response JSON.
- Cùng user + cùng key + request hash khác: trả `IDEMPOTENCY_KEY_CONFLICT`, không chạy nghiệp vụ.
- Canonical request gồm danh sách `{productId, quantity}` đã sort, `addressId` và customer note đã chuẩn hóa; không gồm Address JSON, price, shipping fee hoặc total từ frontend.
- Unique constraint `(user_id, idempotency_key)` xử lý race. Nếu hai request đồng thời cùng tạo, request thua unique race đọc lại row, so hash rồi áp dụng hai quy tắc trên.
- First request thành công trả `201 Created`; retry hợp lệ trả cùng `order_number`. Nếu sau này cần phát lại nguyên HTTP response, giai đoạn 2 có thể bổ sung idempotency record/response snapshot tổng quát.

## 15. Order state machine

```text
PENDING → CONFIRMED → PROCESSING → SHIPPING → COMPLETED
    │          │            │
    └──────────┴────────────┴────────→ CANCELLED
```

Allowed transitions:

| Current | Allowed next |
|---|---|
| PENDING | CONFIRMED, CANCELLED |
| CONFIRMED | PROCESSING, CANCELLED |
| PROCESSING | SHIPPING, CANCELLED |
| SHIPPING | COMPLETED |
| COMPLETED | none |
| CANCELLED | none |

Cancellation ở `CONFIRMED`/`PROCESSING` tự RESTOCK atomically theo mục 13. `SHIPPING` không có transition sang `CANCELLED`.

### 15.1 Transaction cho state transition

Mọi transition do Customer, Staff hoặc Admin khởi tạo phải serialize trên Order row:

```sql
SELECT id, status, payment_status
FROM orders
WHERE id = $1
FOR UPDATE;
```

Trong cùng transaction:

1. Lock Order.
2. Đọc trạng thái hiện tại sau khi lock và kiểm tra allowed transition/actor.
3. Lấy Product ID từ OrderItem, sort tăng dần và lock các Inventory row nếu transition có `COMMIT`, `RELEASE` hoặc `RESTOCK`.
4. Thực hiện stock mutation cùng InventoryTransaction tương ứng.
5. Cập nhật Order và payment fields liên quan.
6. Thêm `OrderStatusHistory`.
7. Thêm `AuditLog(ORDER_STATUS_CHANGED)`.
8. Commit; bất kỳ lỗi nào rollback toàn bộ.

Hai request cạnh tranh, ví dụ `PENDING → CONFIRMED` và `PENDING → CANCELLED`, không được cùng thành công. Request lấy lock sau phải đọc trạng thái mới và trả `INVALID_ORDER_TRANSITION`.

### 15.2 COD payment lifecycle

| Order status | Payment status | `paid_at` |
|---|---|---|
| PENDING | UNPAID | null |
| CONFIRMED | UNPAID | null |
| PROCESSING | UNPAID | null |
| SHIPPING | UNPAID | null |
| COMPLETED | PAID | thời điểm transition |
| CANCELLED | UNPAID | null |

Transition `SHIPPING → COMPLETED` phải đặt `status=COMPLETED`, `payment_status=PAID` và `paid_at=now()` atomically cùng history/audit. Lean MVP không có `mark-paid` endpoint riêng và không có `REFUNDED/FAILED`; các trạng thái đó chỉ được thêm cùng online payment/refund ở migration giai đoạn 2.

## 16. API contract

### Auth

```http
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/verify-email
POST   /api/v1/auth/resend-verification
POST   /api/v1/auth/forgot-password
POST   /api/v1/auth/reset-password
GET    /api/v1/auth/google/url
POST   /api/v1/auth/google/callback
POST   /api/v1/auth/mfa/verify
POST   /api/v1/auth/mfa/setup
POST   /api/v1/auth/mfa/enable
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
```

Email lifecycle contract:

- Password khi register/reset dài `8–128` ký tự; Lean MVP không áp đặt quy tắc
  bắt buộc chữ hoa, chữ thường, số hoặc ký tự đặc biệt. Login chấp nhận password
  tối đa 128 ký tự để giữ input và chi phí hash trong giới hạn.
- Email verification token sống 24 giờ và dùng một lần.
- Resend luôn trả cùng response `202 Accepted` dù email không tồn tại, đã verify, đang pending hay bị block. Chỉ user `PENDING` với `email_verified_at=NULL` đủ điều kiện phát hành token; response không tiết lộ nhánh đã chạy.
- Sau rate limit theo normalized email + IP, backend lock eligible User row `FOR UPDATE`, recheck status, đặt `used_at=now()` cho mọi `EMAIL_VERIFICATION` token cũ chưa dùng, tạo token/hash mới rồi commit. Hai resend đồng thời vì thế không để lại hai token hợp lệ.
- SMTP send xảy ra sau DB commit, không nằm trong database transaction. Nếu gửi lỗi, log `MAIL_DELIVERY_FAILED` đã redacted và vẫn trả generic `202`; user có thể resend lại sau rate-limit window. Lean MVP không có outbox/worker, raw token chỉ tồn tại trong memory đủ để gửi rồi bị loại bỏ.
- Forgot-password luôn trả cùng một response `202 Accepted` dù email có tồn tại hay không để chống account enumeration và chịu rate limit `3/giờ/email`, `10/giờ/IP`. Password-reset token sống 30 phút, dùng một lần; reset thành công revoke toàn bộ session và token reset khác của user. Reset-password chịu rate limit theo token hash, account sau preflight hợp lệ, IP và toàn process. Backend kiểm tra eligibility bằng lookup rẻ trước khi chạy Argon2, sau đó vẫn lock và kiểm tra lại token atomically lúc consume.
- Mọi token gửi qua email là opaque random token tối thiểu 32 bytes; database chỉ lưu hash. Mail và log không ghi token gốc ngoài nội dung email gửi đến đúng người nhận.

API giai đoạn 2, không thuộc OpenAPI/migration Lean MVP:

```http
POST   /api/v1/auth/email/change/request
POST   /api/v1/auth/email/change/confirm
GET    /api/v1/auth/google/link/url
POST   /api/v1/auth/google/link/callback
DELETE /api/v1/auth/google/link
GET    /api/v1/auth/mfa/status
POST   /api/v1/auth/mfa/disable
POST   /api/v1/auth/mfa/recovery-codes/regenerate
POST   /api/v1/auth/logout-all
GET    /api/v1/auth/sessions
DELETE /api/v1/auth/sessions/:sessionId
```

Migration giai đoạn 2 cho email change mới bổ sung enum `EMAIL_CHANGE` và `target_email_normalized` vào `verification_tokens`. Google linking bổ sung các OAuth transaction field mô tả tại mục 9.4. Không tạo các field này trong migration Lean MVP.

### Public catalog

```http
GET /api/v1/categories
GET /api/v1/products
GET /api/v1/products/:slug
```

```text
GET /products?page=1&limit=10&search=...&categoryId=...&sort=-createdAt
```

`sort=-createdAt` ánh xạ thành `ORDER BY created_at DESC, id DESC`. Các Admin/User/Order/Audit list API áp dụng cùng quy tắc tie-breaker theo mục 7.3.

### Customer

```http
GET    /api/v1/me
PATCH  /api/v1/me
POST   /api/v1/me/avatar
GET    /api/v1/me/addresses
POST   /api/v1/me/addresses
PATCH  /api/v1/me/addresses/:id
DELETE /api/v1/me/addresses/:id

GET    /api/v1/cart
POST   /api/v1/cart/items
PATCH  /api/v1/cart/items/:itemId
DELETE /api/v1/cart/items/:itemId

POST   /api/v1/orders
GET    /api/v1/orders
GET    /api/v1/orders/:orderNumber
POST   /api/v1/orders/:orderNumber/cancel
```

### Admin

```http
GET    /api/v1/admin/categories
POST   /api/v1/admin/categories
PATCH  /api/v1/admin/categories/:id
DELETE /api/v1/admin/categories/:id

GET    /api/v1/admin/products
POST   /api/v1/admin/products
GET    /api/v1/admin/products/:id
PATCH  /api/v1/admin/products/:id
DELETE /api/v1/admin/products/:id
POST   /api/v1/admin/products/:id/images
DELETE /api/v1/admin/products/:id/images/:imageId

GET    /api/v1/admin/users
GET    /api/v1/admin/users/:id
PATCH  /api/v1/admin/users/:id/status
PATCH  /api/v1/admin/users/:id/role
POST   /api/v1/admin/users/:id/mfa/reset

GET    /api/v1/admin/orders
GET    /api/v1/admin/orders/:id
PATCH  /api/v1/admin/orders/:id/status

POST   /api/v1/admin/inventory/:productId/adjustments
GET    /api/v1/admin/inventory/:productId/transactions
GET    /api/v1/admin/audit-logs
```

## 17. Response và error contract

### Success

```json
{
  "data": {},
  "meta": {
    "requestId": "..."
  }
}
```

### Pagination

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 50,
    "totalPages": 5
  },
  "meta": {
    "requestId": "..."
  }
}
```

### Error

```json
{
  "error": {
    "code": "PRODUCT_OUT_OF_STOCK",
    "message": "Sản phẩm không đủ tồn kho",
    "details": {
      "productId": "...",
      "available": 2
    }
  },
  "meta": {
    "requestId": "..."
  }
}
```

Frontend sử dụng `error.code` cho logic, không phân tích `message`.

Các error code bắt buộc của các quyết định nghiệp vụ mới:

| HTTP | Code | Khi sử dụng |
|---:|---|---|
| 403 | `AUTH_EMAIL_NOT_VERIFIED` | User PENDING có primary credential hợp lệ nhưng chưa verify email |
| 403 | `AUTH_ACCOUNT_BLOCKED` | User BLOCKED login, refresh hoặc gọi protected API |
| 400 | `OAUTH_STATE_COOKIE_MISMATCH` | State callback không thuộc browser đã bắt đầu flow |
| 400 | `OAUTH_TRANSACTION_INVALID` | State không tồn tại hoặc đã hết hạn |
| 401 | `OAUTH_CODE_EXCHANGE_FAILED` | Google code không hợp lệ hoặc đã hết hạn |
| 401 | `OAUTH_ID_TOKEN_INVALID` | ID token/claim Google không hợp lệ |
| 401 | `OAUTH_IDENTITY_INVALID` | Google identity không còn thuộc user khi tạo session |
| 401 | `OAUTH_NONCE_INVALID` | Google ID token thiếu nonce hoặc nonce không khớp transaction |
| 403 | `OAUTH_EMAIL_NOT_VERIFIED` | Google chưa xác minh email trong ID token |
| 409 | `OAUTH_TRANSACTION_ALREADY_USED` | Google callback retry/race dùng OAuth transaction đã được claim |
| 409 | `OAUTH_ACCOUNT_LINK_REQUIRED` | Email đã thuộc account khác và MVP không auto-link |
| 503 | `OAUTH_PROVIDER_UNAVAILABLE` | Google tạm thời không khả dụng |
| 400 | `MFA_SETUP_REQUIRED` | Enrollment chưa có pending setup hợp lệ hoặc setup đã hết hạn |
| 401 | `MFA_ENROLLMENT_TOKEN_INVALID` | Enrollment token thiếu, không hợp lệ, hết hạn, đã consume hoặc revoke |
| 401 | `MFA_CHALLENGE_INVALID` | MFA challenge không tồn tại, hết hạn hoặc đã consume |
| 401 | `MFA_CODE_INVALID` | TOTP sai/replay hoặc recovery code không hợp lệ/đã dùng |
| 403 | `MFA_NOT_AVAILABLE` | Customer hoặc role không thuộc policy MFA cố gọi MFA enrollment |
| 403 | `MFA_ENROLLMENT_REQUIRED` | Account Staff/Admin đã qua primary auth nhưng chưa hoàn tất MFA và cố truy cập ngoài scope enrollment |
| 409 | `MFA_ALREADY_ENABLED` | Enrollment token cũ cố setup lại method đã bật |
| 429 | `MFA_CHALLENGE_EXHAUSTED` | Challenge đã đạt tối đa 5 lần thử |
| 403 | `MFA_RESET_SELF_FORBIDDEN` | Admin cố dùng recovery endpoint để tự reset MFA |
| 409 | `IDEMPOTENCY_KEY_CONFLICT` | Cùng idempotency key nhưng request hash khác |
| 409 | `LAST_ACTIVE_ADMIN_REQUIRED` | Block/demote Admin ACTIVE cuối cùng hoặc loại bỏ credential quản trị cuối cùng |
| 409 | `CATEGORY_NOT_EMPTY` | Hard-delete Category đã có Product tham chiếu |
| 409 | `INVALID_ORDER_TRANSITION` | State transition không nằm trong bảng cho phép |
| 409 | `PRODUCT_OUT_OF_STOCK` | Stock khả dụng không đủ trong transaction checkout |

## 18. Upload ảnh

Lean MVP dùng flow draft-first:

1. `POST /api/v1/admin/products` luôn tạo `Product(status=DRAFT)` và `Inventory(quantity=0,reserved_quantity=0)` trong cùng transaction; client không thể tạo thẳng `ACTIVE`.
2. `POST /api/v1/admin/products/:id/images` nhận multipart image sau khi Product ID tồn tại, upload object với key chứa Product ID và tạo ProductImage.
3. `PATCH /api/v1/admin/products/:id` chỉ cho chuyển `DRAFT/ARCHIVED → ACTIVE` khi SKU/slug/category/price hợp lệ, Category active và có ít nhất một image; Inventory record phải tồn tại nhưng quantity có thể bằng 0.

Không có `POST /api/v1/uploads/images` chung trong Lean MVP. Avatar dùng endpoint tách biệt `POST /api/v1/me/avatar` và luôn ghi theo authenticated user ID.

Quy tắc chung:

- Chỉ nhận JPEG, PNG và WebP; tối đa 5 MB/file và 10 ảnh/Product.
- Kiểm tra magic bytes, không chỉ MIME/extension.
- Tạo thumbnail/optimized image trước khi liên kết record hoàn tất.
- Lưu `storage_key` để xóa chính xác; frontend không cung cấp arbitrary storage key khi xóa.
- Nếu object upload thành công nhưng database link thất bại, cleanup scheduler xóa orphan object.

```text
products/{productId}/{uuid}.webp
users/{userId}/avatar/{uuid}.webp
```

## 19. Authorization policy

| Chức năng | Customer | Staff | Admin |
|---|:---:|:---:|:---:|
| Xem public products | ✓ | ✓ | ✓ |
| Quản lý profile/cart/order cá nhân | ✓ | ✓ | ✓ |
| Quản lý product/category |  | ✓ | ✓ |
| Quản lý inventory/order |  | ✓ | ✓ |
| Quản lý user role/status |  |  | ✓ |
| Reset MFA cho Staff/Admin khác |  |  | ✓ |
| Xem audit log |  |  | ✓ |
| MFA bắt buộc |  | ✓ | ✓ |

MVP dùng đúng ma trận role cố định ở trên, chưa có permission table hoặc custom role. Mọi service phải kiểm tra ownership hoặc role; không chỉ dựa vào controller guard. Guard dùng User/Session hiện tại từ database theo mục 10. Khi thay đổi role/status, Admin action phải được ghi `audit_logs` và session liên quan phải được revoke trong cùng transaction.

Last-active-admin policy:

- Không được block hoặc hạ role của Admin `ACTIVE` cuối cùng.
- Lean MVP không có API xóa login credential; mọi flow tương lai xóa/unlink credential phải bảo đảm còn ít nhất một Admin ACTIVE có phương thức đăng nhập sử dụng được.
- Service lock các row Admin ACTIVE theo thứ tự ID trong transaction, đếm lại sau lock rồi mới block/demote. Nếu target là Admin ACTIVE cuối cùng, rollback và trả `LAST_ACTIVE_ADMIN_REQUIRED`.
- MFA reset Admin endpoint không cho actor tự reset. Trường hợp chỉ có một Admin bị mất MFA dùng runbook mục 21.1, không nới policy bằng public API.

## 20. Security và rate limit

### Rate limit MVP

| Endpoint | Giới hạn |
|---|---:|
| Register | 3/giờ/email, 20/giờ/IP và 1.000/giờ/process |
| Password login | 5/15 phút/account và IP |
| Resend verification | 3/giờ/email và 10/giờ/IP |
| Forgot password | 3/giờ/email và 10/giờ/IP |
| Reset password | 5/15 phút/token và account, 20/15 phút/IP, 1.000/15 phút/process |
| Google URL | 20/15 phút/IP |
| Google callback | 10/15 phút/IP |
| MFA verify | 5/challenge |
| MFA setup | 5/giờ/user |
| Refresh | 30/15 phút/token family, 60/15 phút/IP, 5.000/15 phút/process |
| Checkout | 10/10 phút/user và IP |

MVP một backend instance có thể dùng in-memory rate-limit store có giới hạn số
bucket và tự dọn bucket hết hạn. Trước khi chạy từ hai instance trở lên, bắt buộc
chuyển counter sang Redis/shared store; không được scale ngang khi mỗi instance
giữ counter riêng.

### CORS, cookie và CSRF

- Production chỉ phục vụ qua HTTPS.
- CORS trả `Access-Control-Allow-Origin` theo exact origin trong allowlist và bật credentials cho frontend tin cậy; không bao giờ kết hợp `Access-Control-Allow-Origin: *` với `credentials=true`.
- Kiến trúc hiện tại đặt frontend và API cùng site; refresh cookie dùng `HttpOnly`, `Secure`, `SameSite=Lax` và giới hạn `Path` vào auth API phù hợp.
- Mọi endpoint phát hành, rotate hoặc revoke refresh cookie (`login`, `refresh`,
  `logout`, và các điểm hoàn tất Google/MFA sau này) kiểm tra `Origin` hoặc
  `Referer` so với allowlist. Business API dùng Bearer access token trong memory,
  không tự đọc access credential từ cookie.
- Nếu frontend và API chuyển thành cross-site, trước khi triển khai phải đổi cookie thành `SameSite=None; Secure` và bổ sung synchronizer token hoặc signed double-submit CSRF token cho mọi cookie-authenticated state-changing request.

### Checklist bảo mật

- Production chỉ dùng HTTPS; cookie production luôn `Secure`.
- CORS dùng exact origin allowlist, không wildcard với credentials; cookie-auth endpoint có Origin/CSRF policy như trên.
- Supabase Data API roles không có grant trên bảng backend; mọi bảng bật RLS
  không policy và frontend không dùng publishable key để đi vòng qua NestJS.
- Google state/nonce one-time, TTL, PKCE S256 và nonce claim matching.
- Redirect URI cấu hình cố định.
- Không log credential, token, Google code, OTP hoặc secret.
- ID token được verify bằng library chính thức.
- Refresh rotation và reuse detection.
- Protected guard kiểm tra current User role/status và Session revocation từ database.
- MFA secret mã hóa; recovery code chỉ lưu hash.
- MFA replay protection dùng conditional update atomic trên `last_used_time_step`.
- Checkout có idempotency key.
- Checkout lock inventory bằng `SELECT ... FOR UPDATE` theo Product ID đã sort.
- Order transition lock Order trước Inventory và ghi state/history/audit atomically.
- Database CHECK constraints và last-active-admin policy là lớp bảo vệ bắt buộc.
- Upload kiểm tra nội dung file.
- Security event và audit log tách biệt.

## 21. Logging và vận hành

Mỗi request có `requestId`. Log gồm method, path, status, duration, user ID nếu có và business/security event phù hợp.

Không log password, cookie, authorization header, access/refresh token, Google code/token, OTP hoặc TOTP secret.

Health endpoints:

```http
GET /health/live
GET /health/ready
```

Lean MVP dùng **một in-process scheduled cleanup job** chạy định kỳ và xử lý theo batch: OAuth transaction, verification token, session cũ, MFA challenge/grant/pending setup hết hạn và orphan image. Job phải idempotent; lỗi được log và batch chưa hoàn tất sẽ được thử lại ở lần chạy kế tiếp. MVP không có queue, background worker riêng, distributed scheduler hoặc retry orchestration phức tạp.

### 21.1 Runbook — phục hồi MFA cho Admin duy nhất

Chỉ dùng khi không còn Admin khác có thể gọi reset API. Không dùng runbook để bỏ qua password/Google primary authentication.

1. Mở incident ticket, xác minh danh tính target bằng quy trình ngoài hệ thống và ghi lý do. Yêu cầu hai người phê duyệt/thực hiện nếu tổ chức có đủ nhân sự; nếu không, ghi rõ ngoại lệ single-operator.
2. Bật maintenance mode cho Admin portal và tạo backup/snapshot các row target trong `users`, `sessions`, MFA tables, `security_events` và `audit_logs`.
3. Dùng ops command/SQL đã review và version-control; không sửa thủ công từng row. Mở một transaction, lock target User `FOR UPDATE`, xác nhận target là `ACTIVE/ADMIN` và vẫn có primary credential.
4. Trong transaction đó: revoke toàn bộ Session/enrollment grant, xóa challenge chưa dùng, TOTP method và recovery codes; không đổi password, email, role hoặc status.
5. Trong cùng transaction, insert `SecurityEvent(MFA_RESET_BY_ADMIN)` và `AuditLog(USER_MFA_RESET)` với `actor_id=NULL`, incident ID/lý do và marker `recovery_runbook=true`; không ghi secret/recovery code. Commit một lần, lỗi thì rollback toàn bộ.
6. Tắt maintenance mode. Admin đăng nhập lại bằng primary credential, nhận enrollment grant, thiết lập TOTP mới và lưu recovery codes mới offline.
7. Xác nhận session cũ bị từ chối, login MFA mới thành công, đính kèm bằng chứng đã redacted vào incident rồi đóng ticket. Không khôi phục TOTP secret cũ từ backup.

## 22. Environment variables

```dotenv
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...
FRONTEND_ORIGIN=http://localhost:5173
TRUST_PROXY_HOPS=0

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:5173/auth/google/callback
OAUTH_TRANSACTION_ENCRYPTION_KEY=

JWT_ACCESS_SECRET=
JWT_ACCESS_TTL=15m
REFRESH_TOKEN_TTL_DAYS=14
COOKIE_SECURE=false

MFA_CHALLENGE_TTL_SECONDS=300
MFA_ENCRYPTION_KEY=

MAIL_PROVIDER=smtp
MAIL_FROM=no-reply@example.com
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=

RATE_LIMIT_STORE=memory
DEFAULT_SHIPPING_FEE_VND=30000
CLEANUP_INTERVAL_SECONDS=3600
CLEANUP_BATCH_SIZE=100
ORPHAN_IMAGE_GRACE_PERIOD_SECONDS=3600

STORAGE_PROVIDER=s3
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=
```

`DATABASE_URL` là kết nối runtime và có thể dùng transaction-mode pooler.
`DIRECT_URL` là kết nối không qua transaction pooler dành cho Prisma migration;
với Supabase dùng session-mode pooler cho URL này. Cả hai biến đều bắt buộc, và
không dùng publishable key của Supabase thay cho database credential.

`TRUST_PROXY_HOPS` mặc định là `0`. Chỉ đặt `1` khi backend luôn nằm sau đúng
một reverse proxy đáng tin cậy và không thể bị truy cập trực tiếp; nếu không,
client có thể giả mạo `X-Forwarded-For`, làm sai rate limit và security event.

Chỉ bổ sung ở giai đoạn 2 trước khi scale ngang:

```dotenv
RATE_LIMIT_STORE=redis
REDIS_URL=redis://...
```

`OAUTH_TRANSACTION_ENCRYPTION_KEY` và `MFA_ENCRYPTION_KEY` là hai secret độc lập, bắt buộc ngay trong MVP để mã hóa PKCE verifier và TOTP secret. Config validation từ chối key thiếu/sai độ dài, shipping fee âm/không phải integer, SMTP chỉ có username hoặc password, và production dùng cookie không `Secure` hoặc frontend/Google redirect không phải HTTPS. SMTP production bắt buộc TLS và có connection/socket timeout. Cơ chế rotation nhiều version của key thuộc giai đoạn 2.

Frontend:

```dotenv
VITE_API_BASE_URL=http://localhost:3000/api/v1
```

## 23. Test strategy

### Auth

- Register, login, refresh và logout.
- Register email/password tạo PENDING và không có session; verify chuyển ACTIVE atomically.
- Resend verification và forgot-password trả generic response, có rate limit và chống account enumeration; hai resend đồng thời chỉ để một token hợp lệ, SMTP failure không làm lộ account.
- Verify/reset token hết hạn và single-use; reset-password yêu cầu opaque token hợp
  lệ, áp dụng counter theo token, account sau preflight  hợp lệ, IP và toàn process,
  đồng thời revoke toàn bộ session.
- PENDING bị từ chối login/refresh; BLOCKED bị từ chối password/Google login, refresh và protected API.
- Refresh rotation và reuse detection.
- Google state/PKCE/nonce, invalid code, nonce mismatch, unverified Google email và invalid ID token.
- Google callback one-time/race: transaction chỉ được claim một lần, retry trả `OAUTH_TRANSACTION_ALREADY_USED` và không tạo user/session trùng.
- Google email trùng account chưa linked bị từ chối an toàn; Lean MVP không có link/unlink flow.
- Staff/Admin MFA setup/enable/challenge/replay và initial recovery codes.
- Hai request đồng thời dùng cùng TOTP time step chỉ một request thành công.
- Recovery code đăng nhập được consume atomically; hai request dùng cùng code chỉ một request thành công và event không lộ code.
- Password và Google callback của Staff/Admin chưa enroll chỉ trả enrollment token; token bị từ chối ở mọi endpoint ngoài setup/enable.
- Enable từ enrollment token mới tạo full session; token hết hạn/đã dùng/đã revoke không dùng lại được và transaction lỗi không để method/session nửa chừng.
- Nâng role lên Staff revoke session và không cấp Staff permission trước khi MFA được bật.
- Hạ Staff/Admin xuống Customer atomically revoke auth state và xóa TOTP/recovery codes; Admin xuống Staff vẫn giữ MFA.
- Admin MFA reset từ chối self-reset, revoke/xóa đúng auth state và buộc target enrollment lại.
- MFA verify/enable chạy đồng thời với Admin reset được serialize bằng User lock; không session nào sống sót sau reset thắng race.
- Customer không có MFA API trong OpenAPI Lean MVP.
- Access token cũ bị từ chối ngay sau logout/session revoke, block, password reset hoặc MFA reset; role hiện tại từ database được áp dụng ngay sau promote/demote.

### User, address và authorization

- User chỉ CRUD Address thuộc chính mình.
- Đặt default address atomically và partial unique index ngăn hai default address.
- Role matrix cố định được kiểm tra ở service; Staff không đọc audit log.
- Hai request đồng thời block/demote các Admin khác nhau không thể làm mất Admin ACTIVE cuối cùng; trả `LAST_ACTIVE_ADMIN_REQUIRED` khi cần.
- AuditLog append-only, chỉ ghi baseline event đã chốt, có before/after data phù hợp và không chứa secret.

### Catalog và inventory

- Unique SKU và slug.
- SKU/slug của Product đã soft delete không được tái sử dụng.
- Chỉ Product `ACTIVE`, chưa soft delete và thuộc Category active mới xuất hiện public.
- `DRAFT`, `ARCHIVED` và soft-deleted Product tuân theo đúng visibility policy.
- Category có Product bị từ chối hard delete bằng `CATEGORY_NOT_EMPTY`; deactivate làm ẩn catalog phù hợp.
- Search name/SKU dùng parameterized `ILIKE`, escape wildcard và trả kết quả phân trang ổn định.
- List pagination dùng `created_at DESC, id DESC`; không lặp/bỏ record trong dataset không đổi và migration có đủ index đã chốt.
- Tạo Product luôn sinh DRAFT + Inventory(0) atomically; image upload chỉ qua Product ID và activation bị từ chối khi dữ liệu/image chưa đủ.
- Avatar upload chỉ ghi storage key theo authenticated user.
- Adjustment luôn tạo InventoryTransaction.
- Hai checkout tranh sản phẩm cuối dưới row-level lock chỉ một request thành công, không deadlock khi nhiều Product nhờ lock order cố định.

### Cart và order

- Giá được tính lại phía server.
- Frontend gửi giá giả không ảnh hưởng total.
- Address không thuộc user bị từ chối; shipping snapshot lấy từ DB, bất biến sau checkout và flat fee chỉ lấy từ backend config.
- Checkout rollback khi reserve thất bại.
- Cùng idempotency key + cùng hash trả Order hiện có; cùng key + hash khác trả `IDEMPOTENCY_KEY_CONFLICT`.
- Hai retry đồng thời cùng idempotency key không tạo order/reservation trùng.
- Cancel PENDING release reservation.
- Confirm order commit stock.
- Cancel CONFIRMED/PROCESSING tự RESTOCK và ghi status history/audit trong cùng transaction; lỗi giữa chừng rollback toàn bộ.
- Customer không hủy sau PENDING; order SHIPPING/COMPLETED không thể cancel.
- Invalid state transition bị từ chối.
- Hai transition đồng thời `PENDING→CONFIRMED` và `PENDING→CANCELLED` chỉ một request thành công nhờ Order row lock.
- `SHIPPING→COMPLETED` đặt `PAID`/`paid_at` atomically; mọi trạng thái COD khác giữ `UNPAID`/`paid_at=null`.

### Security và deployment

- CORS exact-origin và không wildcard khi credentials bật.
- Cookie-auth state change tuân theo Origin/CSRF policy; production cookie là Secure.
- Rate limit login/checkout hoạt động trên in-memory store; deployment Lean MVP giữ đúng một backend replica.
- Cleanup scheduler duy nhất chạy idempotent và xử lý batch hết hạn/orphan mà không cần worker riêng.
- Migration-level tests chèn dữ liệu vi phạm từng CHECK constraint và xác nhận PostgreSQL từ chối.
- Config validation từ chối OAuth/MFA encryption key thiếu và shipping fee âm/không phải integer.
- Thực hiện tabletop test runbook Admin duy nhất: approval, backup, atomic reset, mandatory re-enrollment và audit evidence.

## 24. Thứ tự triển khai

### Release 1 — Lean MVP

1. **Foundation:** NestJS, Prisma, PostgreSQL, Docker Compose, config validation, logging/request ID, exception filter, Swagger, CI, named CHECK constraints và index/stable-ordering đã chốt.
2. **Email/password:** PENDING/ACTIVE/BLOCKED policy, register, verify/resend email, login, forgot/reset password, Mail provider, DB-backed User/Session guard và rotating refresh/logout.
3. **Google Login:** authorization URL, state, PKCE, nonce, encrypted transaction verifier, one-time callback, ID-token verification và frontend callback; chưa link/unlink account.
4. **Staff/Admin MFA:** enrollment grant, QR/manual key, enable, login challenge, initial recovery codes, shared User lock/replay protection, Admin lost-device reset/runbook và role-change policy; không có Customer MFA.
5. **Category/Product/Image:** lifecycle, draft-first Product + Inventory(0), Product-bound image upload, avatar endpoint và Admin CRUD.
6. **Inventory:** adjustment ledger, reserve/release/commit/restock và ordered row lock.
7. **Storefront:** public catalog, Product detail, parameterized `ILIKE`, filter/sort và stable pagination.
8. **Cart:** CRUD item, ownership và server-side current price.
9. **COD checkout:** owned Address snapshot, configured flat fee, server-side totals, transaction, basic key+hash idempotency và stock reserve.
10. **Order management:** Order row lock, state machine, COD paid-at-completion lifecycle, confirmation, cancellation/release/restock và user/Admin views.
11. **Basic audit/operations:** last-active-admin protection, baseline SecurityEvent/AuditLog, one cleanup scheduler, health endpoints và rate limit login/resend/checkout.

Mỗi bước chỉ hoàn tất khi test liên quan ở mục 23 đạt; không tạo schema hoặc endpoint giai đoạn 2 “để sẵn”.

### Release 2 — Production hardening và mở rộng

- Customer MFA, MFA disable và recovery-code regeneration nâng cao.
- Email change.
- Session/device UI, logout-all và revoke từng session.
- Google account link/unlink.
- `pg_trgm`, `unaccent`, ranking và full-text search tiếng Việt sau khi đo hiệu năng.
- Redis rate limit, multi-instance/horizontal scaling và distributed scheduler/worker nếu cần.
- Metrics nâng cao, alert, backup policy, audit retention/export và advanced security monitoring.
- MFA encryption-key rotation, secret rotation, risk-based authentication và các kiểm soát production khác.

## 25. Definition of Done

### Authentication

- Google secret không xuất hiện ở frontend/log.
- Code chỉ exchange ở backend.
- State, PKCE, nonce, redirect URI và ID token được kiểm tra; PKCE verifier dùng encryption key riêng.
- OAuth transaction chỉ được claim một lần; callback retry/race không exchange hoặc tạo session trùng.
- User/identity không tạo trùng.
- Trùng email không auto-link.
- Email registration tạo PENDING; verify kích hoạt; resend generic/rate-limited/serialized và có failure boundary DB–SMTP rõ; PENDING/BLOCKED không nhận session.
- Refresh rotation/reuse detection hoạt động.
- Protected guard dùng User role/status và Session hiện tại từ database nên revoke/block/role change có hiệu lực ngay.
- Verify/reset token được hash, có TTL, dùng một lần và gửi qua Mail provider.
- Staff/Admin MFA secret được mã hóa, OTP chống replay và initial recovery code dùng một lần.
- Staff/Admin bắt buộc MFA; account chưa enroll chỉ có enrollment scope và chỉ nhận full session sau khi enable.
- Promote lên Staff revoke session hiện có; role downgrade về Customer dọn MFA/auth state atomically.
- Admin lost-device reset dùng cùng User lock với verify/enable, hoạt động atomically và không self-reset; last ACTIVE Admin không thể bị block/demote.
- Runbook Admin duy nhất đã được tabletop test và tạo đủ security/audit evidence.
- Lean MVP không expose Customer MFA, disable/regenerate hoặc session-device API.

### Commerce MVP

- Admin đăng nhập và dùng API thật cho Category/Product/Image CRUD, inventory adjustment, order management, user block/unblock và role assignment.
- Ảnh lưu object storage.
- Tạo Product sinh DRAFT + Inventory(0); Product image dùng Product-bound endpoint, avatar dùng endpoint riêng và không có generic upload API.
- Address có ownership và tối đa một default/user.
- Product lifecycle, SKU/slug retention và Category deletion/deactivation đúng policy.
- Public API chỉ trả Product ACTIVE, chưa soft delete, thuộc Category active; search name/SKU dùng parameterized `ILIKE` an toàn.
- List API có index phù hợp và ordering `created_at DESC, id DESC` ổn định.
- Initial migration có đầy đủ named CHECK constraints cho tiền, quantity, inventory và COD payment invariant.
- Cart đọc giá hiện tại từ server.
- Checkout dựng Address snapshot từ row thuộc user, lấy flat shipping fee từ backend config, tính giá server-side, row-lock theo thứ tự cố định và không oversell.
- Idempotency key + request hash trả Order hiện có khi retry, báo conflict khi payload khác và xử lý concurrent request.
- Tạo order reserve stock.
- Confirm order commit stock.
- Cancel PENDING release stock.
- Cancel CONFIRMED/PROCESSING restock atomically; SHIPPING/COMPLETED không thể cancel.
- Mọi Order transition lock Order trước Inventory; transition cạnh tranh chỉ một request thành công.
- COD chỉ UNPAID/PAID; `SHIPPING→COMPLETED` đặt PAID/paid_at atomically và không có mark-paid endpoint.
- SecurityEvent/AuditLog chỉ ghi baseline event quan trọng, append-only, chỉ Admin đọc audit và không chứa secret.
- Một cleanup scheduler idempotent; không có queue/worker phức tạp trong MVP.
- CORS/cookie/CSRF đúng policy; login/resend/checkout rate-limit in-memory và deployment đúng một backend instance.
- API có validation, authorization, OpenAPI và automated tests.
- Initial migration/OpenAPI không chứa endpoint, field hoặc index đã chuyển sang Release 2.

## 26. Kết luận

Tài liệu giữ modular monolith làm kiến trúc đích và một Lean MVP phù hợp website nhỏ đến vừa. Vòng đánh giá trước migration đã được đóng bằng resend-verification, User status policy, OIDC nonce, Order row lock, COD payment lifecycle, draft-first upload, DB-backed auth guard, last-admin protection, Admin MFA recovery, CHECK constraints, shipping contract và query indexes.

Lean MVP hiện đủ điều kiện khóa initial migration và bắt đầu implementation theo thứ tự mục 24. Migration đầu tiên phải bao gồm đúng schema/constraint/index đã chốt và không xây trước các năng lực production hardening của Release 2.

Mọi thay đổi sau này đối với variant, category relation, payment online hoặc stock policy phải được ghi thành ADR mới và cập nhật tài liệu này trước khi tạo migration.
