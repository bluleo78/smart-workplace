// deploy-target 차트 렌더 검증(WP-2142) — helm template 결과만 본다(클러스터 불필요). node --test deploy/helm-deploy-target/tests
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHART = fileURLToPath(new URL('..', import.meta.url));

/** helm template 실행 — 실패도 결과로 돌려준다. targetNamespace 는 기본으로 넣고, omit 이면 뺀다. */
function render({ omit = false, set = {}, json = {} } = {}) {
  const args = ['template', 'fb', CHART, '-n', 'genia-agents'];
  if (!omit) args.push('--set', 'targetNamespace=factory-board');
  for (const [k, v] of Object.entries(set)) args.push('--set', `${k}=${v}`);
  for (const [k, v] of Object.entries(json)) args.push('--set-json', `${k}=${JSON.stringify(v)}`);
  const r = spawnSync('helm', args, { encoding: 'utf8' });
  if (r.error) throw r.error;
  return { ok: r.status === 0, out: r.stdout, err: r.stderr };
}

/** 렌더 결과에서 한 종류의 문서 본문을 모두 뽑는다. */
const ofKind = (out, kind) => out.split(/^---$/m).filter((b) => new RegExp(`^kind: ${kind}$`, 'm').test(b));

/** Role 의 rules 를 「apiGroup/resource → verbs」 표로 펼친다(주석·줄바꿈 모양에 덜 묶이게). */
function rulesOf(role) {
  const table = {};
  const re = /- apiGroups: \[(.*?)\]\n\s+resources: \[(.*?)\]\n\s+verbs: \[(.*?)\]/g;
  const list = (s) => s.split(',').map((x) => x.trim().replace(/"/g, '')).filter((x, i, a) => x !== '' || a.length === 1);
  for (const [, groups, resources, verbs] of role.matchAll(re)) {
    for (const g of list(groups)) for (const r of list(resources)) table[`${g}/${r}`] = list(verbs).sort();
  }
  return table;
}

const BASE = render();

test('failsWithoutTargetNamespace', () => {
  const r = render({ omit: true });
  assert.equal(r.ok, false);
  assert.match(r.err, /targetNamespace/);
});

test('rendersServiceAccountInAgentNamespaceWithoutTokenSecret', () => {
  assert.ok(BASE.ok, BASE.err);
  const [sa] = ofKind(BASE.out, 'ServiceAccount');
  assert.match(sa, /name: deploy-factory-board\n\s+namespace: genia-agents/);
  // 토큰은 runner 가 투영으로 꽂는다(WP-2135) — 장기 토큰 Secret 을 만들지 않는다
  assert.equal(ofKind(BASE.out, 'Secret').length, 0);
});

test('grantsOnlyDeployPermissionsInsideTargetNamespace', () => {
  const [role] = ofKind(BASE.out, 'Role');
  assert.match(role, /namespace: factory-board/);
  assert.deepEqual(rulesOf(role), {
    'apps/deployments': ['create', 'get', 'list', 'patch', 'update', 'watch'],
    'apps/replicasets': ['get', 'list', 'watch'],
    '/services': ['create', 'get', 'list', 'patch', 'update'],
    'networking.k8s.io/ingresses': ['create', 'get', 'list', 'patch', 'update'],
    '/pods': ['get', 'list'],
    '/pods/log': ['get', 'list'],
    // 쿼터는 읽기만 — 배포 AI 가 앱 상한을 풀지 못하게
    '/resourcequotas': ['get', 'list'],
  });
  // 비밀값·컨테이너 진입·삭제는 없다(설명 주석은 빼고 본다)
  assert.doesNotMatch(role.replace(/^\s*#.*$/gm, ''), /secrets|configmaps|pods\/exec|"delete"/);

  const [binding] = ofKind(BASE.out, 'RoleBinding');
  assert.match(binding, /namespace: factory-board/);
  assert.match(binding, /kind: ServiceAccount\n\s+name: deploy-factory-board\n\s+namespace: genia-agents/);
});

test('namespaceAccessIsOffByDefaultAndScopedToOneNameWhenOn', () => {
  assert.equal(ofKind(BASE.out, 'ClusterRole').length, 0);
  assert.equal(ofKind(BASE.out, 'ClusterRoleBinding').length, 0);

  const on = render({ set: { namespaceAccess: 'true' } });
  assert.ok(on.ok, on.err);
  const [cr] = ofKind(on.out, 'ClusterRole');
  assert.match(cr, /resources: \["namespaces"\]\n\s+resourceNames: \["factory-board"\]\n\s+verbs: \["get", "patch"\]/);
  assert.equal(ofKind(on.out, 'ClusterRoleBinding').length, 1);
});

test('reusesExistingServiceAccountAcrossApps', () => {
  // 배포 AI 하나가 앱 여럿을 맡을 때 — 두 번째 앱은 SA 를 만들지 않고 같은 이름에 권한만 묶는다
  const r = render({ set: { 'serviceAccount.create': 'false', 'serviceAccount.name': 'deploy-bot', 'serviceAccount.namespace': 'agents-prod' } });
  assert.ok(r.ok, r.err);
  assert.equal(ofKind(r.out, 'ServiceAccount').length, 0);
  assert.match(ofKind(r.out, 'RoleBinding')[0], /name: deploy-bot\n\s+namespace: agents-prod/);
});

test('appendsExtraRulesInsideTargetNamespace', () => {
  const r = render({ json: { extraRules: [{ apiGroups: ['apps'], resources: ['statefulsets'], verbs: ['get', 'patch'] }] } });
  assert.ok(r.ok, r.err);
  const role = ofKind(r.out, 'Role')[0];
  assert.match(role, /- statefulsets/);
  assert.match(role, /namespace: factory-board/);
});
