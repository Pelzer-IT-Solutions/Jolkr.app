import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import CreateServerDialog from '../../components/dialogs/CreateServer';
import JoinServerDialog from '../../components/dialogs/JoinServer';
import { useMobileNav } from '../../hooks/useMobileNav';

export default function Home() {
  const [searchParams] = useSearchParams();
  const [showCreate, setShowCreate] = useState(searchParams.get('create') === 'true');
  const [showJoin, setShowJoin] = useState(false);
  const { setShowSidebar, isMobile } = useMobileNav();

  // Home page defaults to sidebar view on mobile
  useEffect(() => {
    if (isMobile) setShowSidebar(true);
  }, [isMobile, setShowSidebar]);

  return (
    <div className="flex-1 flex flex-col bg-bg min-h-0">
      {/* Top bar */}
      <div className="h-14 px-4 flex items-center border-b border-divider shrink-0">
        {isMobile && (
          <button onClick={() => setShowSidebar(true)} className="text-text-secondary hover:text-text-primary mr-3">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <span className="text-text-muted mr-2">#</span>
        <span className="text-text-primary font-semibold">Welcome</span>
      </div>

      {/* Welcome content */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-primary/15 flex items-center justify-center">
            <svg className="w-10 h-10 text-primary" fill="currentColor" viewBox="0 0 24 24">
              <path d="M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-text-primary mb-2">Welcome to Jolkr</h1>
          <p className="text-text-secondary mb-8">Select a server or start a conversation</p>
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={() => setShowCreate(true)}
              className="px-6 py-2.5 bg-primary hover:bg-primary-hover text-white rounded font-medium text-sm flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Create a Server
            </button>
            <button
              onClick={() => setShowJoin(true)}
              className="px-6 py-2.5 text-text-secondary hover:text-text-primary text-sm flex items-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
              </svg>
              Join a Server
            </button>
          </div>
        </div>
      </div>

      {showCreate && <CreateServerDialog onClose={() => setShowCreate(false)} />}
      {showJoin && <JoinServerDialog onClose={() => setShowJoin(false)} />}
    </div>
  );
}
