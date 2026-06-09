import React, { createContext, useContext } from 'react';

interface MobileModeContextValue {
  mobileMode: boolean;
  setMobileMode: (enabled: boolean) => void;
}

const MobileModeContext = createContext<MobileModeContextValue>({
  mobileMode: false,
  setMobileMode: () => {},
});

export const MobileModeProvider = MobileModeContext.Provider;

export function useMobileMode(): MobileModeContextValue {
  return useContext(MobileModeContext);
}
