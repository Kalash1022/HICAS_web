import { useId } from 'react';

export default function FormField({ label, placeholder, type = 'text', multiline = false, icon }) {
  const id = useId();

  return (
    <label className="form-field" htmlFor={id}>
      <span>{label}</span>
      <div className={`field-control ${multiline ? 'field-control--textarea' : ''}`}>
        {multiline ? (
          <textarea id={id} placeholder={placeholder} />
        ) : (
          <input id={id} type={type} placeholder={placeholder} />
        )}
        {icon}
      </div>
    </label>
  );
}
