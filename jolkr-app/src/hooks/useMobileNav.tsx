import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useMobileView } from './useMobileView';

interface MobileNavContextValue {
  showSidebar: boolean;
  setShowSidebar: (v: boolean) => void;
  isMobile: boolean;
}

const MobileNavContext = createContext<MobileNavContextValue>({
  showSidebar: true,
  setShowSidebar: () => {},
  isMobile: false,
});

export function MobileNavProvider({ children }: { children: ReactNode }) {
  const isMobile = useMobileView();
  const [showSidebar, setShowSidebar] = useState(true);

  const value = useMemo(() => ({ showSidebar, setShowSidebar, isMobile }), [showSidebar, setShowSidebar, isMobile]);

  return (
    <MobileNavContext.Provider value={value}>
      {children}
    </MobileNavContext.Provider>
  );
}

export function useMobileNav() {
  return useContext(MobileNavContext);
}
