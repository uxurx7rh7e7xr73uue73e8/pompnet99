import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

type Tpl = {
  slug: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  source_type: 'github' | 'docker_image';
  repo_full_name?: string;
  docker_image?: string;
  required_env: Array<{ key: string; description: string; secret: boolean; example?: string }>;
  resources: { cpu: string; memory: string; volume?: string };
  instructions: string;
  providers: string[];
  featured?: number;
};

/**
 * Only templates with a real, deployable source (public repository or public
 * image) are listed. Deployment always goes through the user's own connected
 * provider — POMP NET never claims to host these workloads itself.
 */
export const TEMPLATE_CATALOG: Tpl[] = [
  {
    slug: 'nextjs-starter',
    name: 'Next.js Starter',
    description: 'Official Next.js example application, built and served with Node.',
    category: 'websites',
    icon: 'next',
    source_type: 'github',
    repo_full_name: 'vercel/next.js',
    required_env: [],
    resources: { cpu: '1 vCPU', memory: '512 MB' },
    instructions:
      'Connect GitHub, select vercel/next.js, set the root directory to examples/hello-world, then deploy to your connected provider.',
    providers: ['railway'],
    featured: 1,
  },
  {
    slug: 'fastapi-backend',
    name: 'FastAPI Backend',
    description: 'Production-ready FastAPI + PostgreSQL API template with JWT auth.',
    category: 'apis',
    icon: 'fastapi',
    source_type: 'github',
    repo_full_name: 'fastapi/full-stack-fastapi-template',
    required_env: [
      { key: 'SECRET_KEY', description: 'JWT signing secret', secret: true },
      { key: 'POSTGRES_PASSWORD', description: 'Database password', secret: true },
    ],
    resources: { cpu: '1 vCPU', memory: '512 MB' },
    instructions:
      'Import the repository, set the root directory to backend, add the required variables and attach a PostgreSQL database.',
    providers: ['railway'],
  },
  {
    slug: 'postgres',
    name: 'PostgreSQL',
    description: 'Managed PostgreSQL instance provisioned through your provider.',
    category: 'databases',
    icon: 'postgres',
    source_type: 'docker_image',
    docker_image: 'postgres:16-alpine',
    required_env: [
      { key: 'POSTGRES_PASSWORD', description: 'Superuser password', secret: true },
    ],
    resources: { cpu: '1 vCPU', memory: '1 GB', volume: '5 GB' },
    instructions:
      'Provision from the Databases page so credentials are stored encrypted and injected as variables.',
    providers: ['railway'],
    featured: 1,
  },
  {
    slug: 'redis',
    name: 'Redis',
    description: 'In-memory cache and queue backend.',
    category: 'databases',
    icon: 'redis',
    source_type: 'docker_image',
    docker_image: 'redis:7-alpine',
    required_env: [{ key: 'REDIS_PASSWORD', description: 'Requirepass value', secret: true }],
    resources: { cpu: '0.5 vCPU', memory: '512 MB' },
    instructions: 'Provision from the Databases page and reference the generated URL variable.',
    providers: ['railway'],
  },
  {
    slug: 'mysql',
    name: 'MySQL',
    description: 'Managed MySQL 8 instance.',
    category: 'databases',
    icon: 'mysql',
    source_type: 'docker_image',
    docker_image: 'mysql:8',
    required_env: [{ key: 'MYSQL_ROOT_PASSWORD', description: 'Root password', secret: true }],
    resources: { cpu: '1 vCPU', memory: '1 GB', volume: '5 GB' },
    instructions: 'Provision from the Databases page.',
    providers: ['railway'],
  },
  {
    slug: 'mongodb',
    name: 'MongoDB',
    description: 'Document database for application data.',
    category: 'databases',
    icon: 'mongo',
    source_type: 'docker_image',
    docker_image: 'mongo:7',
    required_env: [{ key: 'MONGO_INITDB_ROOT_PASSWORD', description: 'Root password', secret: true }],
    resources: { cpu: '1 vCPU', memory: '1 GB', volume: '5 GB' },
    instructions: 'Provision from the Databases page.',
    providers: ['railway'],
  },
  {
    slug: 'uptime-kuma',
    name: 'Uptime Kuma',
    description: 'Self-hosted monitoring and status pages.',
    category: 'monitoring',
    icon: 'kuma',
    source_type: 'docker_image',
    docker_image: 'louislam/uptime-kuma:1',
    required_env: [],
    resources: { cpu: '0.5 vCPU', memory: '512 MB', volume: '1 GB' },
    instructions: 'Deploy the image and mount a persistent volume for /app/data.',
    providers: ['railway'],
    featured: 1,
  },
  {
    slug: 'n8n',
    name: 'n8n Workflows',
    description: 'Workflow automation with 400+ integrations.',
    category: 'automation',
    icon: 'n8n',
    source_type: 'docker_image',
    docker_image: 'n8nio/n8n',
    required_env: [
      { key: 'N8N_ENCRYPTION_KEY', description: 'Credential encryption key', secret: true },
    ],
    resources: { cpu: '1 vCPU', memory: '1 GB', volume: '2 GB' },
    instructions: 'Deploy the image, set the encryption key and expose port 5678.',
    providers: ['railway'],
  },
  {
    slug: 'gitea',
    name: 'Gitea',
    description: 'Lightweight self-hosted Git service.',
    category: 'developer-tools',
    icon: 'gitea',
    source_type: 'docker_image',
    docker_image: 'gitea/gitea:1',
    required_env: [],
    resources: { cpu: '1 vCPU', memory: '1 GB', volume: '5 GB' },
    instructions: 'Deploy the image and mount a volume for /data.',
    providers: ['railway'],
  },
  {
    slug: 'directus',
    name: 'Directus',
    description: 'Headless CMS and data platform over SQL.',
    category: 'developer-tools',
    icon: 'directus',
    source_type: 'docker_image',
    docker_image: 'directus/directus:11',
    required_env: [
      { key: 'KEY', description: 'Application key', secret: true },
      { key: 'SECRET', description: 'Application secret', secret: true },
      { key: 'DB_CLIENT', description: 'Database client, e.g. pg', secret: false, example: 'pg' },
    ],
    resources: { cpu: '1 vCPU', memory: '1 GB' },
    instructions: 'Attach a PostgreSQL database and set KEY/SECRET.',
    providers: ['railway'],
  },
  {
    slug: 'grafana',
    name: 'Grafana',
    description: 'Dashboards and visualization for your metrics.',
    category: 'monitoring',
    icon: 'grafana',
    source_type: 'docker_image',
    docker_image: 'grafana/grafana:11.2.0',
    required_env: [],
    resources: { cpu: '0.5 vCPU', memory: '512 MB', volume: '1 GB' },
    instructions: 'Deploy the image and mount a volume for /var/lib/grafana.',
    providers: ['railway'],
  },
  {
    slug: 'ghost',
    name: 'Ghost CMS',
    description: 'Publishing platform for professional blogs and newsletters.',
    category: 'websites',
    icon: 'ghost',
    source_type: 'docker_image',
    docker_image: 'ghost:5-alpine',
    required_env: [
      { key: 'url', description: 'Public site URL', secret: false },
      { key: 'database__connection__password', description: 'MySQL password', secret: true },
    ],
    resources: { cpu: '1 vCPU', memory: '1 GB' },
    instructions: 'Attach a MySQL database and set the public URL variable.',
    providers: ['railway'],
  },
  {
    slug: 'minio',
    name: 'MinIO',
    description: 'S3-compatible object storage.',
    category: 'developer-tools',
    icon: 'minio',
    source_type: 'docker_image',
    docker_image: 'minio/minio',
    required_env: [
      { key: 'MINIO_ROOT_USER', description: 'Root user', secret: true },
      { key: 'MINIO_ROOT_PASSWORD', description: 'Root password', secret: true },
    ],
    resources: { cpu: '1 vCPU', memory: '1 GB', volume: '10 GB' },
    instructions: 'Set the start command to `server /data --console-address :9001`.',
    providers: ['railway'],
  },
  {
    slug: 'metabase',
    name: 'Metabase',
    description: 'Open-source business intelligence and analytics.',
    category: 'monitoring',
    icon: 'metabase',
    source_type: 'docker_image',
    docker_image: 'metabase/metabase',
    required_env: [],
    resources: { cpu: '1 vCPU', memory: '1.5 GB' },
    instructions: 'Deploy the image and connect your database from the Metabase UI.',
    providers: ['railway'],
  },
  {
    slug: 'express-api',
    name: 'Express API',
    description: 'Node.js REST API example with tests.',
    category: 'apis',
    icon: 'node',
    source_type: 'github',
    repo_full_name: 'gothinkster/node-express-realworld-example-app',
    required_env: [],
    resources: { cpu: '0.5 vCPU', memory: '512 MB' },
    instructions: 'Import the repository, then set the start command to `node app.js`.',
    providers: ['railway'],
  },
  {
    slug: 'nginx-static',
    name: 'Static Site (Nginx)',
    description: 'Serve a static build through an Nginx container.',
    category: 'websites',
    icon: 'nginx',
    source_type: 'docker_image',
    docker_image: 'nginx:1.27-alpine',
    required_env: [],
    resources: { cpu: '0.25 vCPU', memory: '256 MB' },
    instructions: 'Deploy the image and add your build output to /usr/share/nginx/html.',
    providers: ['railway'],
  },
];

export function seedTemplates(db: Database.Database): void {
  const insert = db.prepare(
    `INSERT INTO templates
       (id, slug, name, description, category, icon, source_type, repo_full_name, docker_image,
        required_env, resources, instructions, providers, featured, created_at)
     VALUES (@id, @slug, @name, @description, @category, @icon, @source_type, @repo_full_name,
             @docker_image, @required_env, @resources, @instructions, @providers, @featured, @created_at)
     ON CONFLICT(slug) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       category = excluded.category,
       icon = excluded.icon,
       source_type = excluded.source_type,
       repo_full_name = excluded.repo_full_name,
       docker_image = excluded.docker_image,
       required_env = excluded.required_env,
       resources = excluded.resources,
       instructions = excluded.instructions,
       providers = excluded.providers,
       featured = excluded.featured
     WHERE templates.created_by IS NULL`,
  );

  for (const t of TEMPLATE_CATALOG) {
    insert.run({
      id: randomUUID(),
      slug: t.slug,
      name: t.name,
      description: t.description,
      category: t.category,
      icon: t.icon,
      source_type: t.source_type,
      repo_full_name: t.repo_full_name ?? null,
      docker_image: t.docker_image ?? null,
      required_env: JSON.stringify(t.required_env),
      resources: JSON.stringify(t.resources),
      instructions: t.instructions,
      providers: JSON.stringify(t.providers),
      featured: t.featured ?? 0,
      created_at: new Date().toISOString(),
    });
  }
}
