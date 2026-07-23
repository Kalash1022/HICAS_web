export function IconButton({ label, children, onClick }) {
  return (
    <button className="icon-button" type="button" aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

export function PrimaryButton({ children, onClick, type = 'button' }) {
  return (
    <button className="primary-button" type={type} onClick={onClick}>
      {children}
    </button>
  );
}
