import { CalendarDays, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { IconButton, PrimaryButton } from '../common/Buttons';
import FormField from '../common/FormField';

function getFieldIcon(iconName) {
  return iconName === 'calendar' ? <CalendarDays size={18} /> : null;
}

export default function EntityFormModal({ title, fields, returnPath, sizeClass }) {
  const navigate = useNavigate();

  return (
    <main className="modal-stage">
      <section className={`entity-modal ${sizeClass}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal-header">
          <h1 id="modal-title">{title}</h1>
          <IconButton label="Đóng" onClick={() => navigate(returnPath)}><X size={20} /></IconButton>
        </header>

        <form onSubmit={(event) => event.preventDefault()}>
          <div className="modal-fields">
            {fields.map((field) => (
              <FormField {...field} icon={getFieldIcon(field.iconName)} key={field.name} />
            ))}
          </div>

          <footer className="modal-footer">
            <button className="secondary-button" type="button" onClick={() => navigate(returnPath)}>Hủy</button>
            <PrimaryButton type="submit">Tạo mới</PrimaryButton>
          </footer>
        </form>
      </section>
    </main>
  );
}
