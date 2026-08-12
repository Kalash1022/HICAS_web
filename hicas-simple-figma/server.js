import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const { Pool } = pg;
const defaultDatabaseUrl = 'postgresql://postgres:admin@127.0.0.1:5432/HICAS';
const port = Number(process.env.PORT || 3001);
const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = path.dirname(currentFile);
const publicDirectory = existsSync(path.join(currentDirectory, 'dist'))
  ? path.join(currentDirectory, 'dist')
  : path.join(currentDirectory, 'public');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || defaultDatabaseUrl,
  connectionTimeoutMillis: 5000,
});
const scrypt = promisify(scryptCallback);
let server;

const productFields =
  'id, name, price::float8 AS price, quantity, description, category, image_url AS "imageUrl", created_at AS "createdAt"';
const userFields = 'id, full_name AS "fullName", email, role, created_at AS "createdAt"';

class RequestError extends Error {
  constructor(message, code = 'BAD_REQUEST') {
    super(message);
    this.name = 'RequestError';
    this.code = code;
  }
}

function sendError(response, status, code, message) {
  response.status(status).json({
    message,
    error: {
      code,
      message,
    },
  });
}

function optionalText(value, maxLength, fieldName) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new RequestError(fieldName + ' phải là chuỗi ký tự.');
  }

  const text = value.trim();

  if (text.length > maxLength) {
    throw new RequestError(fieldName + ' không được dài quá ' + maxLength + ' ký tự.');
  }

  return text || null;
}

function optionalNonNegativeNumber(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue) || numberValue < 0) {
    throw new RequestError(fieldName + ' phải là số lớn hơn hoặc bằng 0.');
  }

  return numberValue;
}

function requiredNonNegativeNumber(value, fieldName) {
  const numberValue = optionalNonNegativeNumber(value, fieldName);

  if (numberValue === null) {
    throw new RequestError(fieldName + ' là bắt buộc.');
  }

  return numberValue;
}

function requiredNonNegativeInteger(value, fieldName) {
  const numberValue = requiredNonNegativeNumber(value, fieldName);

  if (!Number.isInteger(numberValue)) {
    throw new RequestError(fieldName + ' phải là số nguyên lớn hơn hoặc bằng 0.');
  }

  return numberValue;
}

function readProductPayload(body) {
  const name = optionalText(body?.name, 160, 'Tên sản phẩm');
  const price = requiredNonNegativeNumber(body?.price, 'Giá sản phẩm');
  const quantity =
    body?.quantity === undefined || body?.quantity === null || body?.quantity === ''
      ? 0
      : requiredNonNegativeInteger(body.quantity, 'Số lượng');
  const description = optionalText(body?.description, 2000, 'Mô tả');
  const category = optionalText(body?.category, 80, 'Danh mục') || 'Khác';
  const imageUrl = optionalText(body?.imageUrl, 500, 'Đường dẫn ảnh');

  if (!name) {
    throw new RequestError('Tên sản phẩm là bắt buộc.');
  }

  return {
    name,
    price,
    quantity,
    description,
    category,
    imageUrl,
  };
}

function readProductFilters(query) {
  const search = optionalText(query.search, 160, 'Từ khóa tìm kiếm') || '';
  const minPrice = optionalNonNegativeNumber(query.minPrice, 'Giá tối thiểu');
  const maxPrice = optionalNonNegativeNumber(query.maxPrice, 'Giá tối đa');
  const category = optionalText(query.category, 80, 'Danh mục') || '';

  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    throw new RequestError('Giá tối thiểu không được lớn hơn giá tối đa.');
  }

  return {
    search,
    minPrice,
    maxPrice,
    category,
  };
}

function readUserPayload(body) {
  const fullName = optionalText(body?.fullName, 120, 'Họ và tên');
  const email = optionalText(body?.email, 254, 'Email');
  const password = optionalText(body?.password, 128, 'Mật khẩu');
  const role = optionalText(body?.role, 20, 'Vai trò') || 'staff';

  if (!fullName) throw new RequestError('Họ và tên là bắt buộc.');
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new RequestError('Email không hợp lệ.');
  if (!password || password.length < 8) throw new RequestError('Mật khẩu cần ít nhất 8 ký tự.');
  if (!['admin', 'staff'].includes(role))
    throw new RequestError('Vai trò chỉ có thể là admin hoặc staff.');
  return { fullName, email: email.toLowerCase(), password, role };
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return salt + ':' + Buffer.from(hash).toString('hex');
}

async function verifyPassword(password, passwordHash) {
  const [salt, savedHash] = String(passwordHash).split(':');
  if (!salt || !savedHash) return false;
  const derivedHash = Buffer.from(await scrypt(password, salt, 64));
  const expectedHash = Buffer.from(savedHash, 'hex');
  return expectedHash.length === derivedHash.length && timingSafeEqual(expectedHash, derivedHash);
}

async function initializeDatabase() {
  await pool.query(
    [
      'CREATE TABLE IF NOT EXISTS users (',
      '  id SERIAL PRIMARY KEY,',
      '  full_name VARCHAR(120) NOT NULL,',
      '  email VARCHAR(254) NOT NULL UNIQUE,',
      '  password_hash VARCHAR(256) NOT NULL,',
      "  role VARCHAR(20) NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),",
      '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      ')',
    ].join('\n')
  );

  await pool.query(
    [
      'CREATE TABLE IF NOT EXISTS products (',
      '  id SERIAL PRIMARY KEY,',
      '  name VARCHAR(160) NOT NULL,',
      '  price NUMERIC(14, 2) NOT NULL CHECK (price >= 0),',
      '  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),',
      '  description TEXT,',
      "  category VARCHAR(80) NOT NULL DEFAULT 'Khác',",
      '  image_url VARCHAR(500),',
      '  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      ')',
    ].join('\n')
  );

  await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url VARCHAR(500)');
  await pool.query('CREATE INDEX IF NOT EXISTS products_name_index ON products (name)');
  await pool.query('CREATE INDEX IF NOT EXISTS products_price_index ON products (price)');
  await pool.query('CREATE INDEX IF NOT EXISTS products_category_index ON products (category)');
  await pool.query('CREATE INDEX IF NOT EXISTS users_role_index ON users (role)');

  const userCountResult = await pool.query('SELECT COUNT(*)::int AS count FROM users');
  if (Number(userCountResult.rows[0].count) === 0) {
    const demoUsers = [
      ['Quản trị viên HICAS', 'admin@hicas.local', 'Admin@123', 'admin'],
      ['Nguyễn Minh Anh', 'minh.anh@hicas.local', 'Demo@123', 'staff'],
      ['Trần Quốc Bảo', 'quoc.bao@hicas.local', 'Demo@123', 'staff'],
    ];
    for (const [fullName, email, password, role] of demoUsers) {
      await pool.query(
        'INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
        [fullName, email, await hashPassword(password), role]
      );
    }
  }

  const countResult = await pool.query('SELECT COUNT(*)::int AS count FROM products');

  if (Number(countResult.rows[0].count) > 0) {
    return;
  }

  const seedProducts = [
    {
      name: 'Áo sơ mi Oxford',
      price: 449000,
      quantity: 24,
      category: 'Thời trang',
      description: 'Áo sơ mi Oxford kiểu dáng cơ bản, phù hợp dùng hằng ngày.',
      imageUrl: '/product-images/ao-so-mi-oxford.jpg',
    },
    {
      name: 'Balo Urban Mini',
      price: 890000,
      quantity: 12,
      category: 'Phụ kiện',
      description: 'Balo nhỏ gọn cho nhu cầu đi làm và đi học.',
      imageUrl: '/product-images/balo-urban-mini.jpg',
    },
    {
      name: 'Bình giữ nhiệt HICAS',
      price: 259000,
      quantity: 38,
      category: 'Đồ dùng',
      description: 'Bình giữ nhiệt dung tích 500 ml.',
      imageUrl: '/product-images/binh-giu-nhiet-hicas.jpg',
    },
    {
      name: 'Tai nghe không dây AirLite',
      price: 1299000,
      quantity: 8,
      category: 'Điện tử',
      description: 'Tai nghe Bluetooth nhỏ gọn, có hộp sạc.',
      imageUrl: '/product-images/tai-nghe-airlite.jpg',
    },
    {
      name: 'Sổ tay da A5',
      price: 179000,
      quantity: 45,
      category: 'Văn phòng phẩm',
      description: 'Sổ tay bìa da mềm khổ A5.',
      imageUrl: '/product-images/so-tay-da-a5.jpg',
    },
  ];

  for (const product of seedProducts) {
    await pool.query(
      [
        'INSERT INTO products (name, price, quantity, description, category, image_url)',
        'VALUES ($1, $2, $3, $4, $5, $6)',
      ].join(' '),
      [
        product.name,
        product.price,
        product.quantity,
        product.description,
        product.category,
        product.imageUrl,
      ]
    );
  }
}

const app = express();

app.use(express.json({ limit: '100kb' }));

app.get('/api/health', async (request, response, next) => {
  try {
    await pool.query('SELECT 1');
    response.json({ data: { status: 'ok' } });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', async (request, response, next) => {
  try {
    const email = optionalText(request.body?.email, 254, 'Email');
    const password = optionalText(request.body?.password, 128, 'Mật khẩu');
    if (!email || !password) throw new RequestError('Email và mật khẩu là bắt buộc.');
    const result = await pool.query(
      'SELECT ' + userFields + ', password_hash FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    const row = result.rows[0];
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      sendError(response, 401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng.');
      return;
    }
    const { password_hash, ...user } = row;
    response.json({ data: user, message: 'Đăng nhập thành công.' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/products', async (request, response, next) => {
  try {
    const filters = readProductFilters(request.query);
    const conditions = [];
    const values = [];

    if (filters.search) {
      values.push('%' + filters.search + '%');
      conditions.push('name ILIKE $' + values.length);
    }

    if (filters.minPrice !== null) {
      values.push(filters.minPrice);
      conditions.push('price >= $' + values.length);
    }

    if (filters.maxPrice !== null) {
      values.push(filters.maxPrice);
      conditions.push('price <= $' + values.length);
    }

    if (filters.category) {
      values.push(filters.category);
      conditions.push('category ILIKE $' + values.length);
    }

    const whereClause = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
    const result = await pool.query(
      [
        'SELECT ' + productFields + ', COUNT(*) OVER()::int AS total_count',
        'FROM products' + whereClause,
        'ORDER BY created_at DESC, id DESC',
      ].join(' '),
      values
    );
    const total = result.rows.length ? Number(result.rows[0].total_count) : 0;
    const products = result.rows.map(function (row) {
      const { total_count, ...product } = row;
      return product;
    });

    response.json({
      data: products,
      meta: {
        total,
        filters,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/users', async (request, response, next) => {
  try {
    const search = optionalText(request.query.search, 160, 'Từ khóa tìm kiếm') || '';
    const values = [];
    let whereClause = '';
    if (search) {
      values.push('%' + search + '%');
      whereClause = ' WHERE full_name ILIKE $1 OR email ILIKE $1';
    }
    const result = await pool.query(
      'SELECT ' +
        userFields +
        ', COUNT(*) OVER()::int AS total_count FROM users' +
        whereClause +
        ' ORDER BY created_at DESC, id DESC',
      values
    );
    const total = result.rows.length ? Number(result.rows[0].total_count) : 0;
    response.json({
      data: result.rows.map(({ total_count, ...user }) => user),
      meta: { total, search },
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/products', async (request, response, next) => {
  try {
    const product = readProductPayload(request.body);
    const result = await pool.query(
      [
        'INSERT INTO products (name, price, quantity, description, category, image_url)',
        'VALUES ($1, $2, $3, $4, $5, $6)',
        'RETURNING ' + productFields,
      ].join(' '),
      [
        product.name,
        product.price,
        product.quantity,
        product.description,
        product.category,
        product.imageUrl,
      ]
    );

    response.status(201).json({
      data: result.rows[0],
      message: 'Đã tạo sản phẩm.',
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/users', async (request, response, next) => {
  try {
    const user = readUserPayload(request.body);
    const result = await pool.query(
      'INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING ' +
        userFields,
      [user.fullName, user.email, await hashPassword(user.password), user.role]
    );
    response.status(201).json({ data: result.rows[0], message: 'Đã tạo người dùng.' });
  } catch (error) {
    if (error?.code === '23505') {
      sendError(response, 409, 'EMAIL_EXISTS', 'Email này đã được sử dụng.');
      return;
    }
    next(error);
  }
});

app.use('/api', function (request, response) {
  sendError(response, 404, 'NOT_FOUND', 'Không tìm thấy API được yêu cầu.');
});

app.use(express.static(publicDirectory));

app.get('*', function (request, response) {
  const indexFile = path.join(publicDirectory, 'index.html');
  if (existsSync(indexFile)) response.sendFile(indexFile);
  else response.status(404).send('Ứng dụng chưa được build. Hãy chạy npm run build.');
});

app.use(function (error, request, response, next) {
  if (error instanceof RequestError) {
    sendError(response, 400, error.code, error.message);
    return;
  }

  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    sendError(response, 400, 'INVALID_JSON', 'Nội dung gửi lên không phải JSON hợp lệ.');
    return;
  }

  console.error(error);
  sendError(
    response,
    500,
    'INTERNAL_ERROR',
    'Không thể xử lý yêu cầu. Hãy kiểm tra PostgreSQL rồi thử lại.'
  );
});

async function startServer() {
  try {
    await initializeDatabase();
    server = app.listen(port, function () {
      console.log('HICAS simple app đang chạy tại http://localhost:' + port);
    });
  } catch (error) {
    console.error(
      'Không thể khởi tạo PostgreSQL. Kiểm tra DATABASE_URL và bảo đảm database HICAS đang chạy.'
    );
    console.error(error);
    await pool.end();
    process.exitCode = 1;
  }
}

async function closeApplication() {
  if (server) {
    await new Promise(function (resolve, reject) {
      server.close(function (error) {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  await pool.end();
}

function stopApplication() {
  closeApplication()
    .catch(function (error) {
      console.error('Không thể đóng kết nối PostgreSQL.', error);
    })
    .finally(function () {
      process.exit(0);
    });
}

process.once('SIGINT', stopApplication);
process.once('SIGTERM', stopApplication);

startServer();
