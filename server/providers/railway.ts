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
    // serviceInstanceDeploy is the documented mutation that starts a new
    // deployment for an existing service instance.
    const data = await this.graphql<{ serviceInstanceDeploy: string }>(
      token,
      `mutation ($serviceId: String!, $environmentId: String!) {
         serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
       }`,
      { serviceId: input.serviceId, environmentId: input.environmentId },
    );
    return { deploymentId: data.serviceInstanceDeploy };
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

  async getProjectDetails(token: string, projectId: string): Promise<ProviderProjectDetail> {
    const data = await this.graphql<{
      project: {
        id: string;
        name: string;
        environments: { edges: Array<{ node: { id: string; name: string } }> };
        services: { edges: Array<{ node: { id: string; name: string } }> };
      } | null;
    }>(
      token,
      `query ($id: String!) {
         project(id: $id) {
           id
           name
           environments { edges { node { id name } } }
           services { edges { node { id name } } }
         }
       }`,
      { id: projectId },
    );
    if (!data.project) {
      throw new ApiError(404, 'provider_not_found', 'Railway returned no project for that id');
    }
    return {
      id: data.project.id,
      name: data.project.name,
      environments: (data.project.environments?.edges ?? []).map((edge) => edge.node),
      services: (data.project.services?.edges ?? []).map((edge) => edge.node),
    };
  }

  async listDeployments(
    token: string,
    input: { projectId: string; environmentId: string; serviceId?: string | null; limit?: number },
  ): Promise<ProviderDeploymentSummary[]> {
    const query = `query ($input: DeploymentListInput!, $first: Int) {
      deployments(input: $input, first: $first) {
        edges { node { id status createdAt staticUrl } }
      }
    }`;
    const variables = {
      input: {
        projectId: input.projectId,
        environmentId: input.environmentId,
        serviceId: input.serviceId ?? undefined,
      },
      first: Math.min(Math.max(input.limit ?? 10, 1), 50),
    };
    type Payload = {
      deployments: {
        edges: Array<{
          node: { id: string; status: string; createdAt?: string | null; staticUrl?: string | null };
        }>;
      };
    };
    let data: Payload;
    try {
      data = await this.graphql<Payload>(token, query, variables);
    } catch (err) {
      // Older Railway schema revisions do not expose staticUrl on Deployment.
      if (!/staticUrl/i.test((err as Error).message)) throw err;
      data = await this.graphql<Payload>(
        token,
        `query ($input: DeploymentListInput!, $first: Int) {
           deployments(input: $input, first: $first) { edges { node { id status createdAt } } }
         }`,
        variables,
      );
    }
    return (data.deployments?.edges ?? []).map(({ node }) => ({
      id: node.id,
      rawStatus: node.status,
      status: mapStatus(node.status),
      createdAt: node.createdAt ?? null,
      staticUrl: node.staticUrl ?? null,
    }));
  }

  async getServiceInstance(
    token: string,
    input: { serviceId: string; environmentId: string },
  ): Promise<ServiceInstanceInfo> {
    type Full = {
      serviceInstance: {
        id: string;
        source?: { image?: string | null; repo?: string | null } | null;
        startCommand?: string | null;
        buildCommand?: string | null;
        rootDirectory?: string | null;
        domains?: {
          serviceDomains?: Array<{ id: string; domain: string }>;
          customDomains?: Array<{ id: string; domain: string }>;
        } | null;
      } | null;
    };
    const variables = { serviceId: input.serviceId, environmentId: input.environmentId };
    const build = (instance: Full['serviceInstance'], partial: boolean): ServiceInstanceInfo => ({
      id: instance?.id ?? null,
      source: {
        image: instance?.source?.image ?? null,
        repo: instance?.source?.repo ?? null,
        branch: null,
      },
      startCommand: instance?.startCommand ?? null,
      buildCommand: instance?.buildCommand ?? null,
      rootDirectory: instance?.rootDirectory ?? null,
      domains: [
        ...(instance?.domains?.serviceDomains ?? []).map((d) => ({ ...d, kind: 'service' as const })),
        ...(instance?.domains?.customDomains ?? []).map((d) => ({ ...d, kind: 'custom' as const })),
      ],
      partial,
    });

    try {
      const data = await this.graphql<Full>(
        token,
        `query ($serviceId: String!, $environmentId: String!) {
           serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
             id
             source { image repo }
             startCommand
             buildCommand
             rootDirectory
             domains { serviceDomains { id domain } customDomains { id domain } }
           }
         }`,
        variables,
      );
      return build(data.serviceInstance, false);
    } catch (err) {
      const message = (err as Error).message;
      if (!/does not exist|Cannot query field|Unknown field/i.test(message)) throw err;
      const data = await this.graphql<Full>(
        token,
        `query ($serviceId: String!, $environmentId: String!) {
           serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
             id
             domains { serviceDomains { id domain } customDomains { id domain } }
           }
         }`,
        variables,
      );
      return build(data.serviceInstance, true);
    }
  }

  async updateServiceInstance(
    token: string,
    input: {
      serviceId: string;
      environmentId: string;
      buildCommand?: string | null;
      startCommand?: string | null;
      rootDirectory?: string | null;
      image?: string | null;
    },
  ): Promise<void> {
    const patch: Record<string, unknown> = {};
    if (input.buildCommand !== undefined) patch.buildCommand = input.buildCommand || null;
    if (input.startCommand !== undefined) patch.startCommand = input.startCommand || null;
    if (input.rootDirectory !== undefined) patch.rootDirectory = input.rootDirectory || null;
    if (input.image) patch.source = { image: input.image };
    if (!Object.keys(patch).length) return;

    await this.graphql<{ serviceInstanceUpdate: boolean | null }>(
      token,
      `mutation ($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
         serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
       }`,
      { serviceId: input.serviceId, environmentId: input.environmentId, input: patch },
    );
  }

  async deleteService(token: string, serviceId: string): Promise<void> {
    await this.graphql<{ serviceDelete: boolean }>(
      token,
      `mutation ($id: String!) { serviceDelete(id: $id) }`,
      { id: serviceId },
    );
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
