import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import CreateServerDialog from '../../components/dialogs/CreateServer';
import JoinServerDialog from '../../components/dialogs/JoinServer';
import { useMobileNav } from '../../hooks/useMobileNav';
import { Hash, MessageSquare, LogIn, ChevronLeft } from 'lucide-react';

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
    <div className="flex-1 flex flex-col bg-bg-tertiary min-h-0">
      {/* Top bar */}
      <div className="bg-bg-tertiary px-5 py-3 gap-3 flex items-center border-b border-border-subtle shrink-0">
        {isMobile && (
          <button onClick={() => setShowSidebar(true)} className="text-text-secondary hover:text-text-primary mr-3">
            <ChevronLeft className="size-5" />
          </button>
        )}
        <Hash className="size-4.5 text-text-muted shrink-0" />
        <span className="text-base font-semibold text-text-primary">Welcome</span>
      </div>

      {/* Welcome content */}
      <div className="flex flex-col items-center justify-center flex-1 gap-4">
        <div className="text-center flex flex-col items-center gap-4">
          <div className="size-20 rounded-full bg-accent-muted flex items-center justify-center">
            <MessageSquare className="size-9 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-text-primary">Welcome to Jolkr</h1>
          <p className="text-base text-text-secondary">Select a server or start a conversation</p>
          <div className="flex flex-col gap-3 py-2">
            <button
              onClick={() => setShowCreate(true)}
              className="btn-primary text-sm flex items-center gap-2"
            >
              + Create a Server
            </button>
            <button
              onClick={() => setShowJoin(true)}
              className="text-text-secondary hover:text-text-primary text-sm flex items-center gap-2 justify-center"
            >
              <LogIn className="size-4" />
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
