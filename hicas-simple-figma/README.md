# HICAS Simple Figma

Ứng dụng demo quản lý sản phẩm và người dùng, xây dựng bằng React/Vite theo handoff Figma. Trang cover dùng nhận diện HICAS và bố cục Training.

## Công nghệ

- React 18 + Vite
- Express + PostgreSQL
- Docker Compose (tùy chọn, để chạy PostgreSQL cục bộ)

## Yêu cầu

- Node.js 20 trở lên
- PostgreSQL cục bộ, hoặc Docker Desktop

## Khởi chạy

1. Tạo cấu hình môi trường.

   ```powershell
   Copy-Item .env.example .env
   ```

2. Khởi chạy PostgreSQL (nếu dùng Docker).

   ```powershell
   npm run db:up
   ```

3. Cài đặt và chạy ứng dụng.

   ```powershell
   npm install
   npm run dev
   ```

4. Mở http://localhost:3001.

Lần chạy đầu tiên, server tự tạo bảng `products` và thêm dữ liệu mẫu.

## Scripts

```powershell
npm run dev          # Chạy API Express và giao diện Vite
npm run dev:client   # Chạy riêng giao diện
npm run dev:server   # Chạy riêng API
npm run build        # Build giao diện production
npm run check        # Kiểm tra cú pháp server
```

## API

- `GET /api/products`: lấy danh sách sản phẩm và lọc theo truy vấn.
- `POST /api/products`: tạo sản phẩm mới.
- `GET /api/health`: kiểm tra trạng thái API/database.

## Database

Biến `DATABASE_URL` trong `.env` có định dạng:

```text
postgresql://postgres:admin@127.0.0.1:5432/HICAS
```

Không commit file `.env` vì có thể chứa thông tin kết nối riêng tư.
