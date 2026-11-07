import { ApiError } from '../lib/http.js';
import type {
  CreateServiceInput,
  DeploymentSnapshot,
  LogLine,
  ProviderAccount,
  ProviderAdapter,
  ProviderDeploymentStatus,
  ProviderDeploymentSummary,
  ProviderEnvironment,
  ProviderProject,
  ProviderProjectDetail,
  ServiceInstanceInfo,
} from './types.js';

const DEFAULT_ENDPOINT = 'https://backboard.railway.com/graphql/v2';

/**
 * Railway GraphQL adapter.
 *
 * All calls are executed on the server with a token the workspace owner
 * supplied. POMP NET never proxies anonymously, never stores the token in the
 * browser and never claims Railway infrastructure as its own. Provider errors
 * are surfaced verbatim so the UI can show the real reason an operation failed.
 */
export class RailwayProvider implements ProviderAdapter {
  id = 'railway' as const;
  displayName = 'Railway';
  docsUrl = 'https://docs.railway.com/reference/public-api';
  capabilities = {
    stopService: false,
    resourceMetrics: false,
    rollback: true,
    managedDatabases: true,
  };

  private endpoint(): string {
    return process.env.RAILWAY_API_URL || DEFAULT_ENDPOINT;
  }

  private async graphql<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.endpoint(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new ApiError(
        502,
        'provider_unreachable',
        `Could not reach the Railway API: ${(err as Error).message}`,
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new ApiError(
        409,
        'provider_auth_failed',
        'Railway rejected the stored token. Reconnect the provider with a valid account token.',
      );
    }

    const payload = (await response.json().catch(() => null)) as
      | { data?: T; errors?: Array<{ message?: string }> }
      | null;

    if (!response.ok || !payload) {
      throw new ApiError(502, 'provider_error', `Railway API returned HTTP ${response.status}`);
    }
    if (payload.errors?.length) {
      const message = payload.errors.map((e) => e.message || 'Unknown provider error').join('; ');
      throw new ApiError(502, 'provider_error', `Railway API error: ${message}`);
    }
    if (!payload.data) {
      throw new ApiError(502, 'provider_error', 'Railway API returned an empty response');
    }
    return payload.data;
  }

  async validateConnection(token: string): Promise<ProviderAccount> {
    const data = await this.graphql<{ me: { name: string | null; email: string | null } }>(
      token,
      `query { me { name email } }`,
    );
    return { name: data.me?.name || 'Railway account', email: data.me?.email ?? null };
  }

  async listProjects(token: string): Promise<ProviderProject[]> {
    const data = await this.graphql<{
      me: { projects: { edges: Array<{ node: { id: string; name: string } }> } };
    }>(token, `query { me { projects { edges { node { id name } } } } }`);
    return (data.me?.projects?.edges ?? []).map((e) => e.node);
  }

  async createProject(token: string, name: string): Promise<ProviderProject> {
    const data = await this.graphql<{ projectCreate: { id: string; name: string } }>(
      token,
      `mutation ($name: String!) { projectCreate(input: { name: $name }) { id name } }`,
      { name },
    );
    return data.projectCreate;
  }

  async ensureEnvironment(
    token: string,
    projectId: string,
    name: string,
  ): Promise<ProviderEnvironment> {
    const data = await this.graphql<{
      project: { environments: { edges: Array<{ node: { id: string; name: string } }> } };
    }>(
      token,
      `query ($id: String!) { project(id: $id) { environments { edges { node { id name } } } } }`,
      { id: projectId },
    );
    const existing = (data.project?.environments?.edges ?? [])
      .map((e) => e.node)
      .find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;

    const created = await this.graphql<{
      environmentCreate: { id: string; name: string };
    }>(
      token,
      `mutation ($projectId: String!, $name: String!) {
         environmentCreate(input: { projectId: $projectId, name: $name }) { id name }
       }`,
      { projectId, name },
    );
    return created.environmentCreate;
  }

  async createService(token: string, input: CreateServiceInput): Promise<{ id: string }> {
    const source: Record<string, unknown> = {};
    if (input.repo) {
      source.repo = input.repo;
      if (input.branch) source.branch = input.branch;
    } else if (input.image) {
      source.image = input.image;
    }
    const data = await this.graphql<{ serviceCreate: { id: string } }>(
      token,
      `mutation ($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }`,
      {
        input: {
          projectId: input.projectId,
          environmentId: input.environmentId,
          name: input.name,
          source,
        },
      },
    );
    return { id: data.serviceCreate.id };
  }

  async upsertVariables(
    token: string,
    input: {
      projectId: string;
      environmentId: string;
      serviceId: string;
      variables: Record<string, string>;
    },
  ): Promise<void> {
    await this.graphql<{ variableCollectionUpsert: boolean }>(
      token,
      `mutation ($input: VariableCollectionUpsertInput!) {
         variableCollectionUpsert(input: $input)
       }`,
      {
        input: {
          projectId: input.projectId,
          environmentId: input.environmentId,
          serviceId: input.serviceId,
          variables: input.variables,
        },
      },
    );
  }

  async triggerDeployment(
    token: string,
    input: { serviceId: string; environmentId: string },
  ): Promise<{ deploymentId: string }> {
    const data = await this.graphql<{ deploymentCreate: { id: string } }>(
      token,
      `mutation ($input: DeploymentCreateInput!) { deploymentCreate(input: $input) { id } }`,
      { input: { serviceId: input.serviceId, environmentId: input.environmentId } },
    );
    return { deploymentId: data.deploymentCreate.id };
  }

  async getDeployment(token: string, deploymentId: string): Promise<DeploymentSnapshot> {
    const data = await this.graphql<{ deployment: { status: string } | null }>(
      token,
      `query ($id: String!) { deployment(id: $id) { status } }`,
      { id: deploymentId },
    );
    const raw = data.deployment?.status ?? 'UNKNOWN';
    return { status: mapStatus(raw), rawStatus: raw, error: null };
  }

  async fetchDeploymentLogs(token: string, deploymentId: string): Promise<LogLine[]> {
    const data = await this.graphql<{
      deploymentLogs: Array<{ message: string; severity: string; timestamp: string }>;
    }>(
      token,
      `query ($id: String!) {
         deploymentLogs(deploymentId: $id) { message severity timestamp }
       }`,
      { id: deploymentId },
    );
    return (data.deploymentLogs ?? []).map((l) => ({
      ts: l.timestamp,
      stream: 'build' as const,
      level: /error/i.test(l.severity) ? 'error' : /warn/i.test(l.severity) ? 'warn' : 'info',
      message: l.message,
    }));
  }

  async createServiceDomain(
    token: string,
    input: { serviceId: string; environmentId: string },
  ): Promise<{ id: string | null; domain: string }> {
    const data = await this.graphql<{ serviceDomainCreate: { id: string; domain: string } }>(
      token,
      `mutation ($input: ServiceDomainCreateInput!) {
         serviceDomainCreate(input: $input) { id domain }
       }`,
      { input: { serviceId: input.serviceId, environmentId: input.environmentId } },
    );
    return { id: data.serviceDomainCreate.id ?? null, domain: data.serviceDomainCreate.domain };
  }

  async createCustomDomain(
    token: string,
    input: { serviceId: string; environmentId: string; hostname: string },
  ): Promise<{ id: string | null; status: string; dns: Record<string, unknown> | null }> {
    const data = await this.graphql<{
      customDomainCreate: { id: string; status?: string; dnsRecords?: unknown };
    }>(
      token,
      `mutation ($input: CustomDomainCreateInput!) {
         customDomainCreate(input: $input) { id status }
       }`,
      {
        input: {
          serviceId: input.serviceId,
          environmentId: input.environmentId,
          domain: input.hostname,
        },
      },
    );
    const raw = (data.customDomainCreate.status || 'PENDING_DNS').toUpperCase();
    const status = raw === 'ACTIVE' ? 'active' : raw.includes('FAIL') ? 'failed' : 'pending_dns';
    return { id: data.customDomainCreate.id ?? null, status, dns: null };
  }

  async deleteDomain(token: string, domainId: string): Promise<void> {
    await this.graphql<{ customDomainDelete: boolean }>(
      token,
      `mutation ($id: String!) { customDomainDelete(id: $id) }`,
      { id: domainId },
    );
  }

  async redeploy(
    token: string,
    input: { serviceId: string; environmentId: string },
  ): Promise<{ deploymentId: string }> {
    const data = await this.graphql<{ serviceInstanceDeploy: string }>(
      token,
      `mutation ($serviceId: String!, $environmentId: String!) {
         serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
       }`,
      { serviceId: input.serviceId, environmentId: input.environmentId },
    );
    return { deploymentId: data.serviceInstanceDeploy };
  }

  async rollbackTo(token: string, deploymentId: string): Promise<{ deploymentId: string | null }> {
    const data = await this.graphql<{ deploymentRedeploy: { id: string } | null }>(
      token,
      `mutation ($id: String!) { deploymentRedeploy(id: $id) { id } }`,
      { id: deploymentId },
    );
    return { deploymentId: data.deploymentRedeploy?.id ?? null };
  }
}

export function mapStatus(raw: string): ProviderDeploymentStatus {
  switch (raw.toUpperCase()) {
    case 'QUEUED':
    case 'INITIALIZING':
    case 'WAITING':
    case 'NEEDS_APPROVAL':
      return 'queued';
    case 'BUILDING':
      return 'building';
    case 'DEPLOYING':
      return 'deploying';
    case 'SUCCESS':
      return 'running';
    case 'FAILED':
    case 'CRASHED':
      return 'failed';
    case 'REMOVED':
    case 'SLEEPING':
      return 'stopped';
    case 'SKIPPED':
    case 'CANCELLED':
      return 'cancelled';
    default:
      return 'queued';
  }
}
