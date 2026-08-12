export default function FormField({
  label,
  name,
  value,
  onChange,
  type = 'text',
  required = false,
  multiline = false,
}) {
  return (
    <div className="form-field">
      <label>
        {label} {required && <span>*</span>}
      </label>
      {multiline ? (
        <textarea name={name} value={value} onChange={onChange} rows="2" />
      ) : (
        <input
          name={name}
          type={type}
          value={value}
          onChange={onChange}
          min={type === 'number' ? '0' : undefined}
          required={required}
        />
      )}
    </div>
  );
}
