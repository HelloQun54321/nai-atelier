import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { PromptChain } from '../types';
import { collectionSnapshot, ensureCollection, subscribeCollection } from '../services/collectionFavorites';

export function usePromptLibraryFavorites(chains: PromptChain[]) {
  const snapshot = useSyncExternalStore(subscribeCollection, collectionSnapshot, collectionSnapshot);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let cancelled = false;
    void ensureCollection().then(() => { if (!cancelled) setStatus('ready'); }).catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [snapshot]);
  const ids = useMemo(() => {
    if (status !== 'ready') return undefined;
    const active = snapshot.filter(item => !item.archived);
    const sources = new Set(active.filter(item => item.sourceType === 'other' && item.sourceId).map(item => item.sourceId));
    const legacyUrls = new Set(active.filter(item => !item.sourceId).flatMap(item => [item.imageUrl, item.analysis?.collectionOriginalUrl].filter((url): url is string => typeof url === 'string' && !!url)));
    return new Set(chains.filter(chain => sources.has(chain.id) || !!chain.previewImage && legacyUrls.has(chain.previewImage)).map(chain => chain.id));
  }, [chains, snapshot, status]);
  return { ids, status };
}
