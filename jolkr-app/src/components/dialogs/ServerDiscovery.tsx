import { useState, useEffect } from 'react';
import type { Server } from '../../api/types';
import * as api from '../../api/client';
import { useServersStore } from '../../stores/servers';
import Spinner from '../ui/Spinner';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import EmptyState from '../ui/EmptyState';
import { useNavigate } from 'react-router-dom';
import { rewriteStorageUrl } from '../../platform/config';
import { X, Users, Search } from 'lucide-react';

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
    <Modal open onClose={onClose} className="w-150 max-w-[95vw] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-8 pb-4 border-b border-divider shrink-0">
          <div>
            <h3 className="text-text-primary text-lg font-semibold">Discover Servers</h3>
            <p className="text-text-tertiary text-sm mt-0.5">Find and join public communities</p>
          </div>
          <button onClick={onClose} className="text-text-tertiary hover:text-text-primary" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          {error && <div className="bg-danger/10 text-danger text-sm p-3 rounded-lg mb-4">{error}</div>}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size="md" colors="border-divider border-t-text-muted" />
            </div>
          ) : servers.length === 0 ? (
            <EmptyState icon={<Search className="size-8" />} title="No public servers found" />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {servers.map((server) => (
                  <div key={server.id} className="bg-bg rounded-2xl p-4 border border-divider hover:border-accent/30 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center shrink-0 overflow-hidden">
                        {server.icon_url ? (
                          <img src={rewriteStorageUrl(server.icon_url) ?? server.icon_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-accent font-bold text-sm">{server.name.slice(0, 2).toUpperCase()}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-text-primary font-semibold text-sm truncate">{server.name}</h4>
                        {server.description && (
                          <p className="text-text-tertiary text-xs mt-0.5 line-clamp-2">{server.description}</p>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-text-tertiary flex items-center gap-1">
                            <Users className="size-3" />
                            {server.member_count ?? 0} members
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3">
                      {alreadyJoined.has(server.id) ? (
                        <span className="text-xs text-text-tertiary">Already joined</span>
                      ) : (
                        <Button onClick={() => handleJoin(server.id)} disabled={joining === server.id} fullWidth>
                          {joining === server.id ? 'Joining...' : 'Join Server'}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {hasMore && (
                <div className="flex justify-center mt-4">
                  <button onClick={loadMore} className="px-4 py-2 text-sm text-accent hover:text-accent-hover">
                    Load More
                  </button>
                </div>
              )}
            </>
          )}
        </div>
    </Modal>
  );
}
