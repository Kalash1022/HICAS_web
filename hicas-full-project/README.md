# HICAS Full Project

HICAS Commerce là ứng dụng thương mại điện tử gồm giao diện React cho khách hàng và quản trị viên, cùng API NestJS kết nối PostgreSQL qua Prisma.

## Cấu trúc

```text
frontend/  React + Vite: storefront, giỏ hàng, checkout và quản trị
backend/   NestJS + Prisma: xác thực, sản phẩm, đơn hàng, danh mục và upload
docs/      Tài liệu kiến trúc, khởi tạo admin và phát triển MinIO cục bộ
```

## Yêu cầu

- Node.js 20 trở lên
- PostgreSQL
- npm

## Khởi chạy backend

```powershell
cd backend
Copy-Item .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate:dev
npm run start:dev
```

Thiết lập các biến trong `backend/.env` theo môi trường PostgreSQL của bạn trước khi chạy migration.

## Khởi chạy frontend

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

Giao diện Vite sẽ hiển thị URL local trong terminal (mặc định thường là http://localhost:5173).

## Scripts chính

### Backend

```powershell
npm run build
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

### Frontend

```powershell
npm run build
npm run lint
npm run check
```

## Tài liệu

- `docs/HICAS-Commerce-Integrated-Design.md`: thiết kế tích hợp.
- `docs/Initial-Admin-Bootstrap.md`: khởi tạo tài khoản quản trị.
- `docs/Local-MinIO-Development.md`: phát triển object storage cục bộ.

Các file `.env` không được đưa lên Git. Chỉ dùng `.env.example` làm mẫu cấu hình.
