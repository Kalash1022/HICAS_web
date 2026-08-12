export default function GoogleSignInButton({ disabled = false, onClick }) {
  return (
    <button
      className="google-sign-in-button"
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="google-sign-in-button__mark" aria-hidden="true">G</span>
      Đăng nhập với Google
    </button>
  );
}
