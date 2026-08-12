import { useId } from 'react';

export default function FormField({
  label,
  placeholder,
  type = 'text',
  multiline = false,
  icon,
  id: suppliedId,
  className = '',
  ...inputProps
}) {
  const generatedId = useId();
  const id = suppliedId || generatedId;

  return (
    <div className={'form-field ' + className}>
      <label htmlFor={id}>{label}</label>
      <div className={`field-control ${multiline ? 'field-control--textarea' : ''}`}>
        {multiline ? (
          <textarea id={id} placeholder={placeholder} {...inputProps} />
        ) : (
          <input id={id} type={type} placeholder={placeholder} {...inputProps} />
        )}
        {icon}
      </div>
    </div>
  );
}
