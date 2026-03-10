import { useRef, useState, useEffect } from 'react';
import type { Server } from '../../api/types';
import * as api from '../../api/client';
import { useServersStore } from '../../stores/servers';
import { useNavigate } from 'react-router-dom';
import { rewriteStorageUrl } from '../../platform/config';
import { useFocusTrap } from '../../hooks/useFocusTrap';

export interface ServerDiscoveryProps {
  onClose: () => void;
}

export default function ServerDiscovery({ onClose }: ServerDiscoveryProps) {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const fetchServers = useServersStore((s) => s.fetchServers);
  const myServers = useServersStore((s) => s.servers);
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  useEffect(() => {
    setLoading(true);
    api.discoverServers(20, 0)
      .then((result) => {
        setServers(result);
        setHasMore(result.length >= 20);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const loadMore = async () => {
    const newOffset = offset + 20;
    try {
      const more = await api.discoverServers(20, newOffset);
      setServers((prev) => [...prev, ...more]);
      setOffset(newOffset);
      setHasMore(more.length >= 20);
    } catch (e) {
      setError((e as Error).message || 'Failed to load more servers');
    }
  };

  const handleJoin = async (serverId: string) => {
    setJoining(serverId);
    setError('');
    try {
      await api.joinPublicServer(serverId);
      await fetchServers();
      onClose();
      navigate(`/servers/${serverId}`);
    } catch (e) {
      setError((e as Error).message || 'Failed to join server');
    } finally {
      setJoining(null);
    }
  };

  const alreadyJoined = new Set(myServers.map((s) => s.id));

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div ref={dialogRef} className="bg-surface rounded-2xl border border-divider shadow-popup w-[600px] max-w-[95vw] max-h-[80vh] flex flex-col animate-modal-scale" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-8 pb-4 border-b border-divider shrink-0">
          <div>
            <h3 className="text-text-primary text-lg font-semibold">Discover Servers</h3>
            <p className="text-text-muted text-sm mt-0.5">Find and join public communities</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          {error && <div className="bg-error/10 text-error text-sm p-3 rounded-lg mb-4">{error}</div>}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 rounded-full border-2 border-white/10 border-t-white/40 animate-spin" />
            </div>
          ) : servers.length === 0 ? (
            <div className="text-center py-12 text-text-muted">
              <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <p className="text-sm">No public servers found</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {servers.map((server) => (
                  <div key={server.id} className="bg-bg rounded-2xl p-4 border border-divider hover:border-primary/30 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0 overflow-hidden">
                        {server.icon_url ? (
                          <img src={rewriteStorageUrl(server.icon_url) ?? server.icon_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-primary font-bold text-sm">{server.name.slice(0, 2).toUpperCase()}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-text-primary font-semibold text-sm truncate">{server.name}</h4>
                        {server.description && (
                          <p className="text-text-muted text-xs mt-0.5 line-clamp-2">{server.description}</p>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-text-muted flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {server.member_count ?? 0} members
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3">
                      {alreadyJoined.has(server.id) ? (
                        <span className="text-xs text-text-muted">Already joined</span>
                      ) : (
                        <button
                          onClick={() => handleJoin(server.id)}
                          disabled={joining === server.id}
                          className="btn-primary w-full px-4 py-2 text-sm rounded-lg disabled:opacity-50"
                        >
                          {joining === server.id ? 'Joining...' : 'Join Server'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {hasMore && (
                <div className="flex justify-center mt-4">
                  <button onClick={loadMore} className="px-4 py-2 text-sm text-primary hover:text-primary-hover">
                    Load More
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
