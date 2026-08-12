import { formatPrice } from '../../utils/formatters.js';

export default function ProductTable({ items, loading, error }) {
  const message = error || (loading ? 'Đang tải dữ liệu...' : 'Không có sản phẩm phù hợp.');
  return (
    <section className="product-card">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tên sản phẩm</th>
              <th>Giá</th>
              <th>Số lượng</th>
              <th>Mô tả</th>
              <th>Ảnh</th>
            </tr>
          </thead>
          <tbody>
            {loading || error || !items.length ? (
              <tr>
                <td className="table-message" colSpan="5">
                  {message}
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong className="product-name">{item.name}</strong>
                  </td>
                  <td className="price-cell">{formatPrice(item.price)}</td>
                  <td>{item.quantity}</td>
                  <td className="description-cell">{item.description || '—'}</td>
                  <td>
                    {item.imageUrl ? (
                      <img className="product-image" src={item.imageUrl} alt={'Ảnh ' + item.name} />
                    ) : (
                      <span className="product-image">{item.name[0]}</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
