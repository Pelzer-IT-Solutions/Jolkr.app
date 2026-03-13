import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import CreateServerDialog from '../../components/dialogs/CreateServer';
import JoinServerDialog from '../../components/dialogs/JoinServer';
import { useMobileNav } from '../../hooks/useMobileNav';
import { Hash, MessageSquare, ChevronLeft } from 'lucide-react';

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
    <div className="flex-1 flex flex-col bg-panel min-h-0">
      {/* Top bar */}
      <div className="bg-panel px-5 py-3 gap-3 flex items-center border-b border-border-subtle shrink-0">
        {isMobile && (
          <button onClick={() => setShowSidebar(true)} className="text-text-secondary hover:text-text-primary mr-3">
            <ChevronLeft className="size-5" />
          </button>
        )}
        <Hash className="size-4.5 text-text-tertiary shrink-0" />
        <span className="text-base font-semibold text-text-primary">Welcome</span>
      </div>

      {/* Welcome content */}
      <div className={`flex flex-col items-center justify-center flex-1 gap-4 ${isMobile ? 'px-8' : ''}`}>
        <div className="text-center flex flex-col items-center gap-4">
          <div className={`${isMobile ? 'size-16' : 'size-20'} rounded-full bg-accent-muted flex items-center justify-center`}>
            <MessageSquare className={`${isMobile ? 'size-7' : 'size-9'} text-accent`} />
          </div>
          <h1 className={`${isMobile ? 'text-2xl' : 'text-3xl'} font-bold text-text-primary`}>Welcome to Jolkr</h1>
          <p className={`${isMobile ? 'text-sm' : 'text-base'} text-text-secondary`}>Select a server or start a conversation</p>
          <div className="flex flex-col gap-3 py-2">
            <button
              onClick={() => setShowCreate(true)}
              className={`btn-primary text-sm flex items-center gap-2 ${isMobile ? 'w-65 justify-center' : ''}`}
            >
              Create a Server
            </button>
            <button
              onClick={() => setShowJoin(true)}
              className="text-accent hover:text-accent-hover text-sm font-medium justify-center"
            >
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
