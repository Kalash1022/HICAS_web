export default function AuthAlert({ children }) {
  if (!children) {
    return null;
  }

  return (
    <p className="auth-alert" role="alert" aria-live="polite">
      {children}
    </p>
  );
}
