// agent-runner 차트 렌더 검증(WP-1251) — helm template 결과만 본다(클러스터 불필요). node --test deploy/helm-agent-runner/tests
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHART = fileURLToPath(new URL('..', import.meta.url));

// 필수값 예시 — 각 테스트가 하나씩 빼거나 덧붙여 본다
const REQUIRED = {
  'works.url': 'https://works.example.test',
  'image.tag': '9.9.9',
  runnerToken: 'rt_sentinel_token',
};

/** helm template 실행 — 실패도 결과로 돌려준다. omit 에 적은 필수값은 뺀다. */
function render({ omit = [], set = {}, json = {} } = {}) {
  const args = ['template', 'agent-runner', CHART, '-n', 'agent-pod-test'];
  for (const [k, v] of Object.entries({ ...REQUIRED, ...set })) {
    if (!omit.includes(k)) args.push('--set', `${k}=${v}`);
  }
  for (const [k, v] of Object.entries(json)) args.push('--set-json', `${k}=${JSON.stringify(v)}`);
  const r = spawnSync('helm', args, { encoding: 'utf8' });
  if (r.error) throw r.error;
  return { ok: r.status === 0, out: r.stdout, err: r.stderr };
}

/** 렌더 결과에서 한 종류의 문서 본문을 모두 뽑는다. */
const ofKind = (out, kind) => out.split(/^---$/m).filter((b) => new RegExp(`^kind: ${kind}$`, 'm').test(b));

/** env 항목 한 개의 값(value) */
const envValue = (out, name) => out.match(new RegExp(`- name: ${name}\\n\\s+value: (.*)`))?.[1];

const BASE = render();

test('renders with required values', () => {
  assert.ok(BASE.ok, BASE.err);
});

test('rendersRoleScopedToNamespaceOnly', () => {
  assert.equal(ofKind(BASE.out, 'Role').length, 1);
  assert.equal(ofKind(BASE.out, 'RoleBinding').length, 1);
  assert.equal(ofKind(BASE.out, 'ClusterRole').length, 0);
  assert.equal(ofKind(BASE.out, 'ClusterRoleBinding').length, 0);
  // Pod 를 지울 수 있고, 로그는 읽기만
  const role = ofKind(BASE.out, 'Role')[0];
  assert.match(role, /pods\/log/);
  assert.match(role, /metrics\.k8s\.io/);
  // 작업 화면 보기(WP-1277) — exec 만 더한다(attach·portforward 는 없다)
  assert.match(role, /resources: \["pods\/exec"\]\n\s+verbs: \["create", "get"\]/);
  assert.doesNotMatch(role, /pods\/attach|pods\/portforward/);
});

test('failsWithoutTokenOrExistingSecret', () => {
  const r = render({ omit: ['runnerToken'] });
  assert.equal(r.ok, false);
  assert.match(r.err, /runnerToken|existingSecret/);
  // existingSecret 이 있으면 통과하고 차트가 토큰 Secret 을 만들지 않는다
  const ok = render({ omit: ['runnerToken'], set: { existingSecret: 'my-runner-token' } });
  assert.ok(ok.ok, ok.err);
  assert.equal(ofKind(ok.out, 'Secret').length, 0);
  assert.match(ok.out, /secretName: my-runner-token/);
});

test('rendersWithoutAnyGithubValueAndInjectsNoGithubEnv', () => {
  // WP-1268 — 저장소 토큰은 AI 별로 Works 에 저장한다. 위치 GitHub Secret 값·env 는 없다
  const r = render();
  assert.ok(r.ok, r.err);
  assert.doesNotMatch(r.out, /GITHUB_SECRET_NAME/);
  assert.doesNotMatch(r.out, /github-token/);
});

test('failsWithoutWorksUrlOrImageTag', () => {
  assert.match(render({ omit: ['works.url'] }).err, /works\.url/);
  assert.match(render({ omit: ['image.tag'] }).err, /image\.tag/);
});

test('passesLocationValuesAsJsonEnv', () => {
  const r = render({
    set: { 'agent.storageClass': 'fast-ssd', 'agent.workDisk.type': 'pvc' },
    json: {
      'agent.nodeSelector': { pool: 'agents' },
      'agent.tolerations': [{ key: 'dedicated', operator: 'Equal', value: 'agents', effect: 'NoSchedule' }],
      'agent.hostAliases': [{ ip: '10.0.0.5', hostnames: ['genia-works.iacloud.kr'] }],
    },
  });
  assert.ok(r.ok, r.err);
  // env 값은 JSON 문자열(quote 로 감싸져 있어 한 번 풀어 파싱한다)
  assert.deepEqual(JSON.parse(JSON.parse(envValue(r.out, 'AGENT_NODE_SELECTOR'))), { pool: 'agents' });
  assert.equal(JSON.parse(JSON.parse(envValue(r.out, 'AGENT_TOLERATIONS')))[0].key, 'dedicated');
  assert.equal(JSON.parse(JSON.parse(envValue(r.out, 'AGENT_HOST_ALIASES')))[0].ip, '10.0.0.5');
  assert.equal(JSON.parse(envValue(r.out, 'AGENT_STORAGE_CLASS')), 'fast-ssd');
  assert.equal(JSON.parse(envValue(r.out, 'WORKS_URL')), 'https://works.example.test');
  assert.match(JSON.parse(envValue(r.out, 'ALLOWED_IMAGE_PREFIXES')), /^docker\.io\/iacloudops\/genia-works-agent-,docker:$/);
});

test('defaultsWorkDiskToNodeLocalFolder', () => {
  // WP-1270 — 기본은 노드 로컬 폴더. StorageClass 를 적어도 hostPath 방식이면 넘기지 않는다(쓰지 않는 값)
  const r = render({ set: { 'agent.storageClass': 'nfs' } });
  assert.ok(r.ok, r.err);
  assert.equal(JSON.parse(envValue(r.out, 'AGENT_WORK_DISK_TYPE')), 'hostPath');
  assert.equal(JSON.parse(envValue(r.out, 'AGENT_WORK_HOST_PATH')), '/var/lib/genia-agents');
  assert.equal(envValue(r.out, 'AGENT_STORAGE_CLASS'), undefined);

  const custom = render({ set: { 'agent.workDisk.hostPath': '/data/agents' } });
  assert.equal(JSON.parse(envValue(custom.out, 'AGENT_WORK_HOST_PATH')), '/data/agents');
});

test('caBundleRendersConfigMapOrUsesExistingAndPassesNameToRunner', () => {
  // WP-1276 — 기본은 추가 CA 없음
  assert.equal(envValue(BASE.out, 'AGENT_CA_CONFIGMAP'), undefined);
  assert.equal(ofKind(BASE.out, 'ConfigMap').length, 0);

  const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
  const r = render({ json: { 'agent.caBundle.pem': pem } });
  assert.ok(r.ok, r.err);
  assert.equal(JSON.parse(envValue(r.out, 'AGENT_CA_CONFIGMAP')), 'agent-runner-agent-ca');
  const [cm] = ofKind(r.out, 'ConfigMap');
  assert.match(cm, /name: agent-runner-agent-ca/);
  assert.match(cm, /ca\.crt: \|\n\s+-----BEGIN CERTIFICATE-----\n\s+MIIB/);

  const existing = render({ json: { 'agent.caBundle.pem': pem }, set: { 'agent.caBundle.existingConfigMap': 'corp-ca' } });
  assert.equal(JSON.parse(envValue(existing.out, 'AGENT_CA_CONFIGMAP')), 'corp-ca');
  assert.equal(ofKind(existing.out, 'ConfigMap').length, 0);

  const bad = render({ set: { 'agent.caBundle.pem': 'not-a-cert' } });
  assert.equal(bad.ok, false);
  assert.match(bad.err, /agent\.caBundle\.pem/);
});

test('screenInputIsOffByDefaultAndOnlyOnWhenOperatorAllows', () => {
  // WP-1277 — 입력은 셸 권한과 같아 클러스터 운영자가 켜야만
  assert.equal(JSON.parse(envValue(BASE.out, 'SCREEN_ALLOW_INPUT')), 'false');
  const on = render({ set: { 'screen.allowInput': 'true' } });
  assert.equal(JSON.parse(envValue(on.out, 'SCREEN_ALLOW_INPUT')), 'true');
});

test('pvcWorkDiskOmitsHostPathAndRejectsUnknownType', () => {
  const pvc = render({ set: { 'agent.workDisk.type': 'pvc' } });
  assert.ok(pvc.ok, pvc.err);
  assert.equal(JSON.parse(envValue(pvc.out, 'AGENT_WORK_DISK_TYPE')), 'pvc');
  assert.equal(envValue(pvc.out, 'AGENT_WORK_HOST_PATH'), undefined);

  const bad = render({ set: { 'agent.workDisk.type': 'nfs' } });
  assert.equal(bad.ok, false);
  assert.match(bad.err, /agent\.workDisk\.type/);
});

test('putsSharedHostAliasesOnRunnerAndAgentPods', () => {
  // 공용 hostAliases — runner Deployment 에 들어가고, AI Pod 용 env 에는 agent.hostAliases 앞에 붙는다(WP-1269).
  const r = render({
    json: {
      hostAliases: [{ ip: '192.168.100.72', hostnames: ['genia-works.iacloud.kr'] }],
      'agent.hostAliases': [{ ip: '10.0.0.5', hostnames: ['gitlab.local'] }],
    },
  });
  assert.ok(r.ok, r.err);
  const deployment = ofKind(r.out, 'Deployment')[0];
  assert.match(deployment, /hostAliases:\n\s+- hostnames:\n\s+- genia-works\.iacloud\.kr\n\s+ip: 192\.168\.100\.72/);
  // runner 자신에게는 AI Pod 전용 값이 들어가지 않는다
  assert.doesNotMatch(deployment, /gitlab\.local\n\s+ip/);
  assert.deepEqual(
    JSON.parse(JSON.parse(envValue(r.out, 'AGENT_HOST_ALIASES'))).map((h) => h.ip),
    ['192.168.100.72', '10.0.0.5'],
  );
});

test('omitsRunnerHostAliasesByDefault', () => {
  assert.doesNotMatch(ofKind(BASE.out, 'Deployment')[0], /hostAliases:/);
  assert.deepEqual(JSON.parse(JSON.parse(envValue(BASE.out, 'AGENT_HOST_ALIASES'))), []);
});

test('passesPullSecretsToRunnerAndAgentPods', () => {
  // 기본값 — runner·작업 공간 이미지가 비공개 Docker Hub 에 있어 dockerhub-pull 을 runner 와 AI Pod 모두에 쓴다.
  assert.match(BASE.out, /imagePullSecrets:\n\s+- name: dockerhub-pull/);
  assert.equal(JSON.parse(envValue(BASE.out, 'AGENT_IMAGE_PULL_SECRETS')), 'dockerhub-pull');
  const r = render({ json: { imagePullSecrets: [{ name: 'a' }, { name: 'b' }] } });
  assert.ok(r.ok, r.err);
  assert.equal(JSON.parse(envValue(r.out, 'AGENT_IMAGE_PULL_SECRETS')), 'a,b');
  const none = render({ json: { imagePullSecrets: [] } });
  assert.ok(none.ok, none.err);
  assert.doesNotMatch(none.out, /imagePullSecrets:/);
  assert.equal(JSON.parse(envValue(none.out, 'AGENT_IMAGE_PULL_SECRETS')), '');
});

test('tokenMountedAsFileNotEnv', () => {
  const dep = ofKind(BASE.out, 'Deployment')[0];
  assert.match(dep, /RUNNER_TOKEN_FILE\n\s+value: \/run\/runner\/token/);
  assert.match(dep, /mountPath: \/run\/runner\n\s+readOnly: true/);
  // 토큰 원문은 Deployment 어디에도 없고 Secret 에만 있다
  assert.doesNotMatch(dep, /rt_sentinel_token/);
  assert.doesNotMatch(dep, /secretKeyRef/);
  assert.match(ofKind(BASE.out, 'Secret')[0], /token: "rt_sentinel_token"/);
});

test('quotaRenderedByDefault', () => {
  const quota = ofKind(BASE.out, 'ResourceQuota');
  assert.equal(quota.length, 1);
  assert.match(quota[0], /requests\.cpu: "16"/);
  assert.match(quota[0], /requests\.memory: 64Gi/);
  assert.match(quota[0], /persistentvolumeclaims: "10"/);
  assert.equal(ofKind(render({ set: { 'quota.enabled': 'false' } }).out, 'ResourceQuota').length, 0);
});

test('dindResourcesDefaultAndOverridable', () => {
  // 쿼터(requests.cpu/memory)가 기본으로 켜져 있어 dind 도 requests 가 있어야 AI Pod 가 승인된다 — 기본은 PoC 값
  assert.deepEqual(JSON.parse(JSON.parse(envValue(BASE.out, 'DIND_RESOURCES'))), {
    requests: { cpu: '250m', memory: '512Mi' },
    limits: { cpu: '2', memory: '4Gi' },
  });
  // helm 은 맵을 깊게 합치므로 바꿀 칸을 모두 적는다
  const custom = { requests: { cpu: '1', memory: '2Gi' }, limits: { cpu: '2', memory: '8Gi' } };
  const r = render({ json: { 'dind.resources': custom } });
  assert.ok(r.ok, r.err);
  assert.deepEqual(JSON.parse(JSON.parse(envValue(r.out, 'DIND_RESOURCES'))), custom);
});

test('deploymentUsesRecreateAndOneReplica', () => {
  const dep = ofKind(BASE.out, 'Deployment')[0];
  assert.match(dep, /replicas: 1\b/);
  assert.match(dep, /type: Recreate/);
});

test('healthzUsedForReadinessNotLiveness', () => {
  const dep = ofKind(BASE.out, 'Deployment')[0];
  assert.match(dep, /readinessProbe:\n\s+httpGet:\n\s+path: \/healthz/);
  assert.doesNotMatch(dep, /livenessProbe/);
  assert.doesNotMatch(dep, /startupProbe/);
});

test('runnerContainerIsHardened', () => {
  const dep = ofKind(BASE.out, 'Deployment')[0];
  for (const re of [/runAsNonRoot: true/, /runAsUser: 1000/, /readOnlyRootFilesystem: true/, /allowPrivilegeEscalation: false/, /drop: \["ALL"\]/]) {
    assert.match(dep, re);
  }
  assert.match(dep, /image: "docker\.io\/iacloudops\/genia-works-agent-runner:9\.9\.9"/);
});
