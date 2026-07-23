# HICAS Commerce Backend

NestJS modular monolith cho Lean MVP, được triển khai theo
`../docs/HICAS-Commerce-Integrated-Design.md`.

## Thành phần hiện có

- NestJS 11, TypeScript strict và Prisma 6.19.
- PostgreSQL schema cho IAM, Google OIDC/MFA, catalog, inventory, cart, order và audit.
- Initial migration có named `CHECK` constraints, partial unique indexes và
  stable-pagination indexes.
- Config validation, Pino JSON logging đã redacted, request ID, CORS exact-origin,
  Swagger và health checks.
- Email/password hoàn chỉnh: đăng ký `PENDING`, verify/resend email, login,
  forgot/reset password, Argon2id, rotating refresh token, reuse detection, logout
  và DB-backed User/Session guard.
- SMTP Mail provider với template xác minh email và đặt lại mật khẩu.
- Các module commerce còn lại được tách theo domain và sẽ tiếp tục triển khai theo
  thứ tự Release 1.

## Chuẩn bị môi trường

```powershell
cd backend
Copy-Item .env.example .env
npm.cmd install
npm.cmd run prisma:generate
```

Điền toàn bộ giá trị bắt buộc trong `.env`; file này đã được gitignore và không
được commit. `DATABASE_URL` dùng cho runtime, còn `DIRECT_URL` dùng cho Prisma
migration.

Ba secret sau phải được tạo riêng, không dùng chung:

- `JWT_ACCESS_SECRET`: chuỗi ngẫu nhiên tối thiểu 32 ký tự.
- `OAUTH_TRANSACTION_ENCRYPTION_KEY`: đúng 32 byte dưới dạng base64/base64url
  hoặc 64 ký tự hex.
- `MFA_ENCRYPTION_KEY`: đúng 32 byte và khác OAuth encryption key.

Có thể chạy lệnh sau ba lần để tạo ba giá trị độc lập:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Khi dùng Docker Compose local, đặt `S3_ACCESS_KEY=minioadmin` và
`S3_SECRET_KEY=minioadmin` để khớp MinIO. Mailpit không yêu cầu
`SMTP_USER`/`SMTP_PASSWORD`.

Config validation hiện kiểm tra cấu hình của toàn Lean MVP. Vì vậy các biến
Google, MFA và S3 vẫn phải có giá trị khi khởi động, dù endpoint Google/MFA đang
ở bước triển khai kế tiếp. Có thể dùng placeholder được ghi rõ là local-only khi
chỉ kiểm thử Email/Password; tuyệt đối không triển khai production bằng
placeholder.

## Kết nối Supabase PostgreSQL

Backend dùng Prisma kết nối PostgreSQL; `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
không phải database credential và không thể dùng để chạy migration.

1. Mở Supabase Dashboard, chọn **Connect** và lấy PostgreSQL connection string.
2. Dùng transaction-mode pooler cổng `6543` cho application runtime.
3. Dùng session-mode pooler cổng `5432` cho Prisma migrations.
4. Nếu mật khẩu có ký tự đặc biệt, percent-encode mật khẩu trước khi đặt vào URL.

Với project hiện tại, cấu hình trong `backend/.env` có dạng:

```dotenv
DATABASE_URL="postgresql://postgres.ltawosbbyrphoytdraso:[YOUR-PASSWORD]@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require"
DIRECT_URL="postgresql://postgres.ltawosbbyrphoytdraso:[YOUR-PASSWORD]@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require"
```

Thay `[YOUR-PASSWORD]` bằng database password thật, sau đó chạy:

```powershell
npm.cmd run prisma:migrate:deploy
```

Initial migration chứa constraint/index không biểu diễn đầy đủ được trong Prisma
schema. Vì vậy luôn dùng `prisma migrate deploy`; không dùng `prisma db push` cho
dự án này.

### Khóa Supabase Data API

Ứng dụng này chỉ truy cập dữ liệu qua NestJS/Prisma; frontend không được query
các bảng commerce hoặc IAM bằng Supabase publishable key. Migration
`0002_lock_down_supabase_data_api`:

- revoke quyền trực tiếp của `anon`, `authenticated` và `service_role`;
- revoke default privileges để bảng Prisma tạo sau này không tự mở;
- bật RLS không policy trên mọi bảng backend như lớp bảo vệ thứ hai.

Nếu dự án không dùng REST/GraphQL Data API cho tính năng nào khác, nên tắt hẳn
Data API trong Supabase Dashboard. Mỗi bảng backend thêm mới phải bật RLS trong
migration và được thêm vào database E2E security check.

## Chạy local

Khởi động hạ tầng local và backend:

```powershell
docker compose up -d postgres minio mailpit
npm.cmd run prisma:migrate:deploy
npm.cmd run start:dev
```

- API: `http://localhost:3000/api/v1`
- Swagger: `http://localhost:3000/api/docs`
- Liveness: `http://localhost:3000/health/live`
- Readiness: `http://localhost:3000/health/ready`
- Mailpit: `http://localhost:8025`
- MinIO console: `http://localhost:9001`

MinIO trong Compose chỉ dành cho phát triển local. Production phải cấu hình
object storage S3-compatible được quản lý riêng.

### Triển khai sau reverse proxy

`TRUST_PROXY_HOPS` quyết định Express có tin địa chỉ client trong header
`X-Forwarded-For` hay không. Giá trị mặc định `0` không tin proxy và phù hợp khi
backend nhận kết nối trực tiếp.

Chỉ đặt `TRUST_PROXY_HOPS=1` khi request luôn đi qua đúng một reverse proxy đáng
tin cậy và backend không thể bị truy cập trực tiếp từ Internet. Nếu có nhiều lớp
proxy, chỉ đặt đúng số hop sau khi đã xác minh mọi đường mạng tới backend. Cấu
hình sai có thể cho phép client giả mạo IP, làm sai rate limit và security event.

## Email/Password API

| Endpoint | HTTP | Mục đích |
|---|---:|---|
| `/api/v1/auth/register` | `201` | Tạo Customer `PENDING` và gửi email xác minh |
| `/api/v1/auth/verify-email` | `200` | Consume verification token và kích hoạt user |
| `/api/v1/auth/resend-verification` | `202` | Phát hành lại verification token |
| `/api/v1/auth/login` | `200` | Xác thực password, trả access token và đặt refresh cookie |
| `/api/v1/auth/forgot-password` | `202` | Gửi email đặt lại mật khẩu |
| `/api/v1/auth/reset-password` | `200` | Consume reset token, đổi password và revoke session |
| `/api/v1/auth/refresh` | `200` | Rotate refresh token và cấp access token mới |
| `/api/v1/auth/logout` | `200` | Revoke session hiện tại và xóa refresh cookie |

Request body:

| Endpoint | JSON body |
|---|---|
| `register` | `{ "email", "fullName", "password" }` |
| `verify-email` | `{ "token" }` |
| `resend-verification` | `{ "email" }` |
| `login` | `{ "email", "password" }` |
| `forgot-password` | `{ "email" }` |
| `reset-password` | `{ "token", "newPassword" }` |
| `refresh`, `logout` | Không có body; dùng refresh cookie |

Password mới phải dài từ 8 đến 128 ký tự. Backend normalize email trước khi lookup
và hash password bằng Argon2id. Verification token sống 24 giờ; password-reset
token sống 30 phút. Token chỉ dùng một lần và database chỉ lưu hash.

`resend-verification` và `forgot-password` luôn trả cùng response `202`, kể cả
khi email không tồn tại hoặc không đủ điều kiện. Frontend không được dùng hai
endpoint này để suy luận tài khoản có tồn tại hay không.

### Response envelope

Mọi response thành công được bọc trong `data` và có `requestId`:

```json
{
  "data": {
    "accessToken": "<jwt>",
    "expiresIn": 900,
    "user": {
      "id": "<uuid>",
      "email": "customer@example.com",
      "fullName": "Customer",
      "role": "CUSTOMER"
    }
  },
  "meta": {
    "requestId": "<request-id>"
  }
}
```

Lỗi có contract ổn định; frontend phải xử lý theo `error.code`, không phân tích
`message`:

```json
{
  "error": {
    "code": "AUTH_INVALID_CREDENTIALS",
    "message": "Email or password is incorrect."
  },
  "meta": {
    "requestId": "<request-id>"
  }
}
```

Các error code chính của Email/Password:

| HTTP | Code |
|---:|---|
| `400` | `AUTH_EMAIL_VERIFICATION_TOKEN_INVALID` |
| `400` | `AUTH_PASSWORD_RESET_TOKEN_INVALID` |
| `401` | `AUTH_INVALID_CREDENTIALS` |
| `401` | `AUTH_ACCESS_TOKEN_INVALID` |
| `401` | `AUTH_SESSION_INVALID` |
| `401` | `AUTH_REFRESH_TOKEN_INVALID` |
| `401` | `AUTH_REFRESH_TOKEN_REUSED` |
| `403` | `AUTH_EMAIL_NOT_VERIFIED` |
| `403` | `AUTH_ACCOUNT_BLOCKED` |
| `403` | `AUTH_ORIGIN_FORBIDDEN` |
| `403` | `AUTH_FORBIDDEN` |
| `409` | `AUTH_EMAIL_ALREADY_REGISTERED` |
| `429` | `AUTH_RATE_LIMITED` |

### Access token, refresh cookie và Origin

- Access token sống mặc định 15 phút và chỉ được frontend giữ trong memory.
- Refresh token là opaque token, database chỉ lưu hash và rotate sau mỗi lần
  refresh.
- Cookie có tên `hicas_refresh_token`, `HttpOnly`, `SameSite=Lax`, path
  `/api/v1/auth`; production phải đặt `COOKIE_SECURE=true`.
- Frontend phải dùng `credentials: "include"` cho login, refresh và logout.
- `login`, `refresh` và `logout` chỉ chấp nhận `Origin`, hoặc origin lấy từ
  `Referer`, khớp chính xác một giá trị trong `FRONTEND_ORIGIN`.
- Bearer access token vẫn cần cho các protected business API; role/status và
  session hiện tại luôn được guard đọc lại từ database.

Ví dụ refresh từ frontend:

```js
await fetch(`${apiBaseUrl}/auth/refresh`, {
  method: 'POST',
  credentials: 'include',
});
```

Nếu gọi bằng công cụ không tự thêm `Origin`, phải gửi header khớp với
`FRONTEND_ORIGIN`.

### Kiểm tra email bằng Mailpit

Sau khi chạy Compose, mở `http://localhost:8025`, đăng ký hoặc gọi forgot-password
và mở email vừa nhận. Link xác minh và reset trỏ tới:

- `${FRONTEND_ORIGIN}/auth/verify-email?token=...`
- `${FRONTEND_ORIGIN}/auth/reset-password?token=...`

Frontend cần cung cấp đúng hai route này để consume token qua API. SMTP được gọi
sau khi database commit; nếu gửi lỗi, backend ghi log đã redacted và người dùng
có thể yêu cầu gửi lại sau rate-limit window.

## Rate limit Email/Password

- Register: 3 lần/giờ/email, 20 lần/giờ/IP và 1.000 lần/giờ/process.
- Login: 5 lần/15 phút theo normalized account và theo IP.
- Resend verification: 3 lần/giờ/email và 10 lần/giờ/IP.
- Forgot password: 3 lần/giờ/email và 10 lần/giờ/IP.
- Reset password: 5 lần/15 phút/token và account, 20 lần/15 phút/IP và 1.000
  lần/15 phút/process; token được kiểm tra rẻ trước khi chạy Argon2 và được kiểm
  tra lại atomically khi consume.
- Refresh: 30 lần/15 phút/token family, 60 lần/15 phút/IP và 5.000 lần/15
  phút/process.

Rate-limit store được giới hạn kích thước, tự dọn bucket hết hạn, nhưng vẫn chỉ
phù hợp một backend instance. Phải chuyển sang Redis/shared store trước khi scale
ngang.

## Kiểm tra

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test -- --runInBand
npm.cmd run test:e2e -- --runInBand
npm.cmd run build
```

Database E2E chỉ được bật với database local/disposable:

```powershell
$env:RUN_DATABASE_E2E='1'
npm.cmd run test:e2e -- --runInBand
```

Không bật `RUN_DATABASE_E2E` khi `DATABASE_URL` trỏ đến production hoặc database
Supabase dùng chung. Backend CI dùng PostgreSQL service tạm thời, apply migration
trước và đặt `RUN_DATABASE_E2E=1`.

## Bước triển khai kế tiếp

Email/Password của Release 1 đã hoàn thành. Bước tiếp theo là Google OIDC:
authorization URL, state, PKCE, nonce, one-time callback và ID-token verification.
Sau Google Login mới triển khai TOTP MFA bắt buộc cho Staff/Admin.
