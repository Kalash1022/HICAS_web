import { Pencil, Trash2 } from 'lucide-react';
import { IconButton } from './Buttons';

export default function RowActions({ entityName, disabled = false, onEdit, onDelete }) {
  const editDisabled = disabled || !onEdit;
  const deleteDisabled = disabled || !onDelete;

  return (
    <div className="row-actions">
      <IconButton
        label={editDisabled ? `Chỉnh sửa ${entityName} (chưa khả dụng)` : `Chỉnh sửa ${entityName}`}
        disabled={editDisabled}
        onClick={onEdit}
      >
        <Pencil size={22} />
      </IconButton>
      <IconButton
        label={deleteDisabled ? `Xóa ${entityName} (chưa khả dụng)` : `Xóa ${entityName}`}
        disabled={deleteDisabled}
        onClick={onDelete}
      >
        <Trash2 size={22} />
      </IconButton>
    </div>
  );
}
