'use client';

import { createContext, useContext, type ReactNode } from 'react';

import { MAIN_PASTED_TEXT_SCOPE } from './scope';

const PastedTextScopeContext = createContext(MAIN_PASTED_TEXT_SCOPE);

export const PastedTextScopeProvider = ({
  children,
  scope,
}: {
  children: ReactNode;
  scope: string;
}) => <PastedTextScopeContext.Provider value={scope}>{children}</PastedTextScopeContext.Provider>;

export const usePastedTextScope = () => useContext(PastedTextScopeContext);
