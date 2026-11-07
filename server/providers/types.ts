export type ProviderId = 'railway';

export interface ProviderAccount {
  name: string;
  email: string | null;
}

export interface ProviderProject {
  id: string;
  name: string;
}

export interface ProviderEnvironment {
  id: string;
  name: string;
}

export interface ProviderServiceSummary {
  id: string;
  name: string;
}

export interface ProviderProjectDetail {
  id: string;
  name: string;
  environments: ProviderEnvironment[];
  services: ProviderServiceSummary[];
}

export type ProviderDeploymentStatus =
  | 'queued'
  | 'building'
  | 'deploying'
  | 'running'
  | 'failed'
  | 'stopped'
  | 'cancelled';

export interface DeploymentSnapshot {
  status: ProviderDeploymentStatus;
  rawStatus: string;
  error: string | null;
}

export interface ProviderDeploymentSummary {
  id: string;
  rawStatus: string;
  status: ProviderDeploymentStatus;
  createdAt: string | null;
  staticUrl: string | null;
}

export interface ProviderDomain {
  id: string;
  domain: string;
  kind: 'service' | 'custom';
}

export interface ServiceInstanceInfo {
  id: string | null;
  source: { image: string | null; repo: string | null; branch: string | null };
  startCommand: string | null;
  buildCommand: string | null;
  rootDirectory: string | null;
  domains: ProviderDomain[];
  /** True when the provider returned a reduced payload because optional fields are unsupported. */
  partial: boolean;
}

export interface LogLine {
  ts: string;
  stream: 'build' | 'runtime';
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface ProviderCapabilities {
  /** Whether the provider's public API can stop a running service. */
  stopService: boolean;
  /** Whether historical CPU/memory series are exposed to this integration. */
  resourceMetrics: boolean;
  /** Whether a previous deployment can be re-activated. */
  rollback: boolean;
  /** Whether the provider issues managed database instances through its API. */
  managedDatabases: boolean;
}

export interface CreateServiceInput {
  projectId: string;
  environmentId: string;
  name: string;
  repo?: string | null;
  branch?: string | null;
  image?: string | null;
  rootDirectory?: string | null;
}

export interface ProviderAdapter {
  id: ProviderId;
  displayName: string;
  docsUrl: string;
  capabilities: ProviderCapabilities;
  validateConnection(token: string): Promise<ProviderAccount>;
  listProjects(token: string): Promise<ProviderProject[]>;
  createProject(token: string, name: string): Promise<ProviderProject>;
  ensureEnvironment(token: string, projectId: string, name: string): Promise<ProviderEnvironment>;
  getProjectDetails(token: string, projectId: string): Promise<ProviderProjectDetail>;
  createService(token: string, input: CreateServiceInput): Promise<{ id: string }>;
  getServiceInstance(
    token: string,
    input: { serviceId: string; environmentId: string },
  ): Promise<ServiceInstanceInfo>;
  updateServiceInstance(
    token: string,
    input: {
      serviceId: string;
      environmentId: string;
      buildCommand?: string | null;
      startCommand?: string | null;
      rootDirectory?: string | null;
      image?: string | null;
    },
  ): Promise<void>;
  deleteService(token: string, serviceId: string): Promise<void>;
  upsertVariables(
    token: string,
    input: {
      projectId: string;
      environmentId: string;
      serviceId: string;
      variables: Record<string, string>;
    },
  ): Promise<void>;
  triggerDeployment(
    token: string,
    input: { serviceId: string; environmentId: string },
  ): Promise<{ deploymentId: string }>;
  listDeployments(
    token: string,
    input: { projectId: string; environmentId: string; serviceId?: string | null; limit?: number },
  ): Promise<ProviderDeploymentSummary[]>;
  getDeployment(token: string, deploymentId: string): Promise<DeploymentSnapshot>;
  fetchDeploymentLogs(token: string, deploymentId: string): Promise<LogLine[]>;
  createServiceDomain(
    token: string,
    input: { serviceId: string; environmentId: string },
  ): Promise<{ id: string | null; domain: string }>;
  createCustomDomain(
    token: string,
    input: { serviceId: string; environmentId: string; hostname: string },
  ): Promise<{ id: string | null; status: string; dns: Record<string, unknown> | null }>;
  deleteDomain(token: string, domainId: string): Promise<void>;
  redeploy(token: string, input: { serviceId: string; environmentId: string }): Promise<{ deploymentId: string }>;
  rollbackTo(token: string, deploymentId: string): Promise<{ deploymentId: string | null }>;
}
