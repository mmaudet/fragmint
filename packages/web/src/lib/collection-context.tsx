import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { CollectionWithRole } from '@/api/types';

interface CollectionContextValue {
  activeCollection: string;
  collections: CollectionWithRole[];
  setActiveCollection: (slug: string) => void;
  setCollections: (cols: CollectionWithRole[]) => void;
  isReadOnly: boolean;
}

const CollectionContext = createContext<CollectionContextValue | null>(null);

export function CollectionProvider({ children }: { children: ReactNode }) {
  const [activeCollection, setActiveState] = useState<string>(() => {
    return localStorage.getItem('fragmint-collection') || 'common';
  });
  const [collections, setCollections] = useState<CollectionWithRole[]>([]);

  const setActiveCollection = useCallback((slug: string) => {
    setActiveState(slug);
    localStorage.setItem('fragmint-collection', slug);
  }, []);

  const isReadOnly = collections.find(c => c.slug === activeCollection)?.read_only ?? false;

  return (
    <CollectionContext.Provider value={{ activeCollection, collections, setActiveCollection, setCollections, isReadOnly }}>
      {children}
    </CollectionContext.Provider>
  );
}

export function useCollection() {
  const ctx = useContext(CollectionContext);
  if (!ctx) throw new Error('useCollection must be used within CollectionProvider');
  return ctx;
}
