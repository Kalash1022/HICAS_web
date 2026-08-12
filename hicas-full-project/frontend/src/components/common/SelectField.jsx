import { useId } from 'react';

export default function SelectField({
  label,
  id: suppliedId,
  className = '',
  children,
  ...selectProps
}) {
  const generatedId = useId();
  const id = suppliedId || generatedId;

  return (
    <div className={'form-field ' + className}>
      <label htmlFor={id}>{label}</label>
      <div className="field-control">
        <select id={id} {...selectProps}>{children}</select>
      </div>
    </div>
  );
}
