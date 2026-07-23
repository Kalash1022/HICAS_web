import { products } from '../../data/mockData';
import Pagination from '../common/Pagination';
import RowActions from '../common/RowActions';
import TableHeader from './TableHeader';

const columns = ['Tên sản phẩm', 'Giá', 'Số lượng', 'Mô tả', 'Ảnh', 'Hành động'];

function ProductRow({ product }) {
  return (
    <div className="table-row" role="row">
      <div className="name-cell" role="cell">{product.name}</div>
      <div role="cell">{product.price}</div>
      <div role="cell">{product.stock}</div>
      <div role="cell">{product.description}</div>
      <div role="cell"><img className="product-image" src={`/assets/products/${product.image}`} alt={`Ảnh ${product.name}`} /></div>
      <div role="cell"><RowActions entityName={product.name} /></div>
    </div>
  );
}

export default function ProductTable() {
  return (
    <div className="table-card">
      <div className="data-table product-table" role="table" aria-label="Danh sách sản phẩm">
        <TableHeader columns={columns} />
        {products.map((product) => <ProductRow product={product} key={product.id} />)}
      </div>
      <Pagination />
    </div>
  );
}
