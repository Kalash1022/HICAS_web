export function IconButton({ label, children, onClick, disabled = false, className = '' }) {
  return (
    <button className={'icon-button ' + className} type="button" aria-label={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function PrimaryButton({ children, onClick, type = 'button', disabled = false, className = '' }) {
  return (
    <button className={'primary-button ' + className} type={type} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
