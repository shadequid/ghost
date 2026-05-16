import React, { type ReactNode } from 'react';
import { GatewayContext, useGatewayClient } from '../hooks/useGateway';

export interface GatewayProviderProps {
  children: ReactNode;
}

export function GatewayProvider({ children }: GatewayProviderProps) {
  const value = useGatewayClient();
  return React.createElement(GatewayContext.Provider, { value }, children);
}
