export default function Modal({ title, onClose, children }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="product-dialog react-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
