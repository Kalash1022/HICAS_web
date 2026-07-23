import { Pencil, Trash2 } from 'lucide-react';
import { IconButton } from './Buttons';

export default function RowActions({ entityName }) {
  return (
    <div className="row-actions">
      <IconButton label={`Chỉnh sửa ${entityName}`}><Pencil size={22} /></IconButton>
      <IconButton label={`Xóa ${entityName}`}><Trash2 size={22} /></IconButton>
    </div>
  );
}
