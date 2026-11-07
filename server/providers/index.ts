import { db } from '../db.js';
import { decryptSecret } from '../lib/crypto.js';
import { unavailable } from '../lib/http.js';
import { RailwayProvider } from './railway.js';
import type { ProviderAdapter, ProviderId } from './types.js';

const adapters: Record<ProviderId, ProviderAdapter> = {
  railway: new RailwayProvider(),
};

export function getAdapter(id: string): ProviderAdapter {
  const adapter = adapters[id as ProviderId];
  if (!adapter) throw unavailable(`Provider "${id}" is not supported yet`);
  return adapter;
}

export function listAdapters(): ProviderAdapter[] {
  return Object.values(adapters);
}

export interface ProviderContext {
  adapter: ProviderAdapter;
  token: string;
  connectionId: string;
}

/**
 * Resolves the workspace's own provider connection. Without it every
 * infrastructure operation fails with an explicit integration_required error —
 * POMP NET never falls back to shared credentials or simulated results.
 */
export function requireProviderConnection(workspaceId: string, provider = 'railway'): ProviderContext {
  const row = db
    .prepare(
      `SELECT * FROM provider_connections WHERE workspace_id = ? AND provider = ?`,
    )
    .get(workspaceId, provider) as any;
  if (!row) {
    throw unavailable(
      `No ${provider} account is connected to this workspace. Connect your own provider token in Settings → Providers to enable real deployments.`,
      { provider, required: 'provider_connection' },
    );
  }
  if (row.status !== 'connected') {
    throw unavailable(
      `The ${provider} connection for this workspace is ${row.status}. Reconnect it in Settings → Providers.`,
      { provider, status: row.status },
    );
  }
  return {
    adapter: getAdapter(provider),
    token: decryptSecret(row.token_encrypted),
    connectionId: row.id,
  };
}

export function hasProviderConnection(workspaceId: string, provider = 'railway'): boolean {
  const row = db
    .prepare(`SELECT status FROM provider_connections WHERE workspace_id = ? AND provider = ?`)
    .get(workspaceId, provider) as { status: string } | undefined;
  return row?.status === 'connected';
}
