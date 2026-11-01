// KubeCluster — 설치한 @kubernetes/client-node 가 실제로 보내는 요청(경로·쿼리·Content-Type)을 가짜 API 서버로 확인한다.
// server-side apply 가 merge patch 로 나가거나 네임스페이스·라벨 셀렉터가 빠지면 운영에서만 깨지므로 선으로 본다.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KubeConfig } from '@kubernetes/client-node';
import { ClusterError, KubeCluster } from './cluster.js';
import { buildAgentSecret } from './manifest.js';

interface Seen {
  method: string;
  path: string;
  query: URLSearchParams;
  contentType: string | undefined;
  body: string;
}

const seen: Seen[] = [];
let server: Server;
let cluster: KubeCluster;

/** discovery(GET /api/v1) — KubernetesObjectApi 가 kind → 복수형 경로를 찾을 때 부른다. */
const CORE_RESOURCES = {
  kind: 'APIResourceList',
  apiVersion: 'v1',
  groupVersion: 'v1',
  resources: [
    { name: 'pods', singularName: 'pod', namespaced: true, kind: 'Pod', verbs: ['get', 'list', 'patch', 'delete'] },
    { name: 'secrets', singularName: 'secret', namespaced: true, kind: 'Secret', verbs: ['get', 'list', 'patch', 'delete'] },
    {
      name: 'persistentvolumeclaims',
      singularName: 'persistentvolumeclaim',
      namespaced: true,
      kind: 'PersistentVolumeClaim',
      verbs: ['get', 'list', 'patch', 'delete'],
    },
    { name: 'configmaps', singularName: 'configmap', namespaced: true, kind: 'ConfigMap', verbs: ['get', 'list', 'patch', 'delete'] },
  ],
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const body = await readBody(req);
    seen.push({ method: req.method ?? '', path: url.pathname, query: url.searchParams, contentType: req.headers['content-type'], body });
    const json = (status: number, obj: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (url.pathname === '/api/v1') return json(200, CORE_RESOURCES);
    if (url.pathname.startsWith('/apis/metrics.k8s.io/')) {
      return json(200, {
        kind: 'PodMetricsList',
        apiVersion: 'metrics.k8s.io/v1beta1',
        metadata: {},
        items: [
          {
            metadata: { name: 'agent-42', namespace: 'agents' },
            timestamp: '',
            window: '',
            containers: [
              { name: 'agent', usage: { cpu: '1000m', memory: '1Gi' } },
              { name: 'dind', usage: { cpu: '200000000n', memory: '1024Ki' } },
            ],
          },
        ],
      });
    }
    if (req.method === 'GET' && /\/namespaces\/agents\/[a-z]+$/.test(url.pathname)) {
      return json(200, { kind: 'List', apiVersion: 'v1', metadata: {}, items: [] });
    }
    if (req.method === 'GET' && url.pathname.endsWith('/missing')) {
      return json(404, { kind: 'Status', apiVersion: 'v1', status: 'Failure', code: 404, reason: 'NotFound' });
    }
    if (req.method === 'DELETE' && url.pathname.endsWith('/gone')) {
      return json(404, { kind: 'Status', apiVersion: 'v1', status: 'Failure', code: 404, reason: 'NotFound' });
    }
    if (req.method === 'PATCH' && url.pathname.endsWith('/agent-99')) {
      // 쿼터 거절 — 서버 메시지는 여러 줄일 수 있고 보낸 값이 섞일 수 있다
      return json(403, {
        kind: 'Status',
        apiVersion: 'v1',
        status: 'Failure',
        code: 403,
        reason: 'Forbidden',
        message: 'pods "agent-99" is forbidden: exceeded quota: agent-runner, requested: requests.cpu=4\nsecond line',
      });
    }
    if (req.method === 'PATCH') {
      return json(200, JSON.parse(body));
    }
    if (req.method === 'DELETE') return json(200, { kind: 'Status', apiVersion: 'v1', status: 'Success' });
    return json(200, { kind: 'Secret', apiVersion: 'v1', metadata: { name: 'x' } });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;

  const kc = new KubeConfig();
  kc.loadFromOptions({
    clusters: [{ name: 'c', server: `http://127.0.0.1:${port}`, skipTLSVerify: true }],
    users: [{ name: 'u', token: 'sa-token' }],
    // kubeconfig 기본 네임스페이스는 일부러 다르게 — runner 가 늘 자기 네임스페이스를 넣는지 본다
    contexts: [{ name: 'ctx', cluster: 'c', user: 'u', namespace: 'default' }],
    currentContext: 'ctx',
  });
  cluster = new KubeCluster(kc, 'agents');
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  seen.length = 0;
});

describe('KubeCluster', () => {
  it('appliesWithServerSideApplyInOwnNamespace', async () => {
    await cluster.apply(buildAgentSecret(42, 3, 'whatever', { 'agent-key': 'ak_x' }, {}));
    const patch = seen.find((s) => s.method === 'PATCH');
    expect(patch?.path).toBe('/api/v1/namespaces/agents/secrets/agent-42');
    expect(patch?.query.get('fieldManager')).toBe('genia-agent-runner');
    expect(patch?.query.get('force')).toBe('true');
    expect(patch?.contentType).toContain('application/apply-patch+yaml');
    expect(JSON.parse(patch?.body ?? '{}').metadata.namespace).toBe('agents');
  });

  it('wrapsRejectionWithStatusReasonAndOneLineMessage', async () => {
    const pod = { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'agent-99' } };
    const err = await cluster.apply(pod).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClusterError);
    const ce = err as ClusterError;
    expect(ce.status).toBe(403);
    expect(ce.rejected).toBe(true);
    expect(ce.message).toBe(
      'k8s apply Pod/agent-99 실패 (403 Forbidden: pods "agent-99" is forbidden: exceeded quota: agent-runner, requested: requests.cpu=4)',
    );

    // Secret 은 서버 메시지에 보낸 값이 되돌아올 수 있어 사유만 담는다
    const secretErr = (await cluster
      .apply(buildAgentSecret(99, 3, 'agents', { 'agent-key': 'ak_secret_value' }, {}))
      .catch((e: unknown) => e)) as ClusterError;
    expect(secretErr.message).toBe('k8s apply Secret/agent-99 실패 (403 Forbidden)');
  });

  it('listsOnlyRunnerLabeledResources', async () => {
    await cluster.listManaged();
    const lists = seen.filter((s) => s.method === 'GET').map((s) => [s.path, s.query.get('labelSelector')]);
    expect(lists.sort()).toEqual(
      [
        ['/api/v1/namespaces/agents/configmaps', 'app.kubernetes.io/managed-by=genia-agent-runner'],
        ['/api/v1/namespaces/agents/persistentvolumeclaims', 'app.kubernetes.io/managed-by=genia-agent-runner'],
        ['/api/v1/namespaces/agents/pods', 'app.kubernetes.io/managed-by=genia-agent-runner'],
        ['/api/v1/namespaces/agents/secrets', 'app.kubernetes.io/managed-by=genia-agent-runner'],
      ].sort(),
    );
  });

  it('deletesByNameAndIgnoresNotFound', async () => {
    await cluster.delete('Pod', 'agent-42');
    await cluster.delete('Secret', 'gone');
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      'DELETE /api/v1/namespaces/agents/pods/agent-42',
      'DELETE /api/v1/namespaces/agents/secrets/gone',
    ]);
  });

  it('existsReadsByNameAndMapsNotFound', async () => {
    expect(await cluster.exists('ConfigMap', 'missing')).toBe(false);
    expect(await cluster.exists('Secret', 'agent-42')).toBe(true);
    expect(seen.map((s) => s.path)).toEqual([
      '/api/v1/namespaces/agents/configmaps/missing',
      '/api/v1/namespaces/agents/secrets/agent-42',
    ]);
  });

  it('readsPodMetricsInNamespaceAndSumsContainers', async () => {
    const usage = await cluster.podMetrics();
    expect(seen[0]?.path).toBe('/apis/metrics.k8s.io/v1beta1/namespaces/agents/pods');
    expect(usage.get('agent-42')).toEqual({ cpuMillicores: 1200, memoryBytes: 1024 ** 3 + 1024 * 1024 });
  });
});
