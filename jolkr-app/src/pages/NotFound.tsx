import { useNavigate } from 'react-router-dom';
import { getAccessToken } from '../api/client';
import Button from '../components/ui/Button';
import s from './NotFound.module.css';

export default function NotFound() {
  const navigate = useNavigate();
  const isLoggedIn = !!getAccessToken();

  return (
    <div className={s.page}>
      <div className={s.code}>404</div>
      <h1 className={s.title}>Page Not Found</h1>
      <p className={s.message}>
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Button onClick={() => navigate(isLoggedIn ? '/' : '/login')}>
        {isLoggedIn ? 'Go Home' : 'Log In'}
      </Button>
    </div>
  );
}
