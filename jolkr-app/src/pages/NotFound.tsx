import { useNavigate } from 'react-router-dom';
import { getAccessToken } from '../api/client';
import Button from '../components/ui/Button';
import { useT } from '../hooks/useT';
import s from './NotFound.module.css';

export default function NotFound() {
  const { t } = useT();
  const navigate = useNavigate();
  const isLoggedIn = !!getAccessToken();

  return (
    <div className={s.page}>
      <div className={s.code}>404</div>
      <h1 className={s.title}>{t('notFound.title')}</h1>
      <p className={s.message}>{t('notFound.message')}</p>
      <Button onClick={() => navigate(isLoggedIn ? '/' : '/login')}>
        {isLoggedIn ? t('common.goHome') : t('auth.login.submit')}
      </Button>
    </div>
  );
}
