-- ---------------------------------------------------------------------------
-- POMP NET CLOUD — relational schema (SQLite dialect)
-- Every table is scoped to a workspace or a resource inside one.
-- ---------------------------------------------------------------------------
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  email_verified_at TEXT,
  is_platform_owner INTEGER NOT NULL DEFAULT 0,
  suspended_at TEXT,
  suspended_reason TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  ip TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('email_verify','password_reset')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id, type);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL REFERENCES users(id),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','starter','pro')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','developer','viewer')),
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON workspace_members(user_id);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','developer','viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invitations_ws ON invitations(workspace_id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL REFERENCES users(id),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_projects_ws ON projects(workspace_id);

CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('production','staging','development','custom')),
  created_at TEXT NOT NULL,
  UNIQUE (project_id, slug)
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('github','docker_image','template')),
  repo_full_name TEXT,
  branch TEXT,
  root_directory TEXT NOT NULL DEFAULT '/',
  docker_image TEXT,
  build_command TEXT,
  start_command TEXT,
  healthcheck_path TEXT,
  auto_deploy INTEGER NOT NULL DEFAULT 0,
  webhook_secret TEXT,
  template_slug TEXT,
  provider TEXT NOT NULL DEFAULT 'railway',
  provider_project_id TEXT,
  provider_environment_id TEXT,
  provider_service_id TEXT,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','deploying','running','failed','stopped','unavailable')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_services_project ON services(project_id);
CREATE INDEX IF NOT EXISTS idx_services_env ON services(environment_id);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued','building','deploying','running','failed','stopped','cancelled')),
  trigger TEXT NOT NULL CHECK (trigger IN ('manual','github_push','rollback','redeploy')),
  commit_sha TEXT,
  commit_message TEXT,
  commit_author TEXT,
  provider TEXT,
  provider_deployment_id TEXT,
  error_message TEXT,
  rollback_of TEXT,
  created_by TEXT REFERENCES users(id),
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deployments_service ON deployments(service_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS deployment_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  stream TEXT NOT NULL CHECK (stream IN ('build','runtime','system')),
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info','warn','error')),
  message TEXT NOT NULL,
  UNIQUE (deployment_id, stream, ts, message)
);
CREATE INDEX IF NOT EXISTS idx_deploylogs_dep ON deployment_logs(deployment_id, id);

CREATE TABLE IF NOT EXISTS environment_variables (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL,
  value_encrypted TEXT NOT NULL,
  is_secret INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (environment_id, service_id, key)
);

CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('provider','custom')),
  status TEXT NOT NULL CHECK (status IN ('pending_dns','verifying','active','failed')),
  provider_domain_id TEXT,
  dns_record TEXT,
  ssl_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (ssl_status IN ('unknown','pending','issued','failed')),
  created_at TEXT NOT NULL,
  verified_at TEXT,
  UNIQUE (service_id, hostname)
);

CREATE TABLE IF NOT EXISTS databases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  environment_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  engine TEXT NOT NULL CHECK (engine IN ('postgres','mysql','redis','mongodb')),
  status TEXT NOT NULL CHECK (status IN ('provisioning','ready','failed','deleting')),
  provider TEXT NOT NULL DEFAULT 'railway',
  provider_project_id TEXT,
  provider_environment_id TEXT,
  provider_service_id TEXT,
  connection_host TEXT,
  connection_port INTEGER,
  connection_db TEXT,
  connection_user TEXT,
  connection_password_encrypted TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_connections (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('railway','github')),
  label TEXT NOT NULL,
  token_encrypted TEXT NOT NULL,
  account_name TEXT,
  account_email TEXT,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected','invalid','revoked')),
  last_checked_at TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, provider)
);

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  icon TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('github','docker_image')),
  repo_full_name TEXT,
  docker_image TEXT,
  required_env TEXT NOT NULL DEFAULT '[]',
  resources TEXT NOT NULL DEFAULT '{}',
  instructions TEXT NOT NULL DEFAULT '',
  providers TEXT NOT NULL DEFAULT '["railway"]',
  featured INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT,
  actor_id TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_ws ON activity_logs(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  actor_id TEXT,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  ip TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id TEXT,
  service_id TEXT,
  metric TEXT NOT NULL CHECK (metric IN ('cpu_seconds','memory_gb_seconds','network_gb','disk_gb','deployments','database_provisioned')),
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  source TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_ws ON usage_records(workspace_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS error_reports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  user_id TEXT,
  path TEXT,
  message TEXT NOT NULL,
  stack TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_errors_created ON error_reports(created_at DESC);

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github','google')),
  provider_user_id TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts(user_id);
