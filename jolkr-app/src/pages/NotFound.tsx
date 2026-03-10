import { useNavigate } from 'react-router-dom';
import { getAccessToken } from '../api/client';

export default function NotFound() {
  const navigate = useNavigate();
  const isLoggedIn = !!getAccessToken();

  return (
    <div className="h-full flex flex-col items-center justify-center bg-bg text-center p-8">
      <div className="text-6xl font-bold text-text-muted mb-4">404</div>
      <h1 className="text-xl font-bold text-text-primary mb-2">Page Not Found</h1>
      <p className="text-text-secondary text-sm mb-6">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <button
        onClick={() => navigate(isLoggedIn ? '/' : '/login')}
        className="px-4 py-2 btn-primary text-sm rounded-lg"
      >
        {isLoggedIn ? 'Go Home' : 'Log In'}
      </button>
    </div>
  );
}
