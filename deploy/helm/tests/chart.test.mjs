// 운영 Helm 차트 렌더 검증(WP-438) — helm template 결과만 본다(클러스터 불필요). node --test deploy/helm/tests 로 돈다.
// 지키는 것: 이미지는 digest 로만, 모든 파드에 pull secret, 비밀값은 차트가 만들지 않음, converter 연결, 릴리스 정보는 파드에 안 들어감.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CHART = fileURLToPath(new URL('..', import.meta.url));
const PROD_VALUES = fileURLToPath(new URL('../values.prod.yaml', import.meta.url));
const IMAGES = fileURLToPath(new URL('./images.fixture.yaml', import.meta.url));

/** helm template 실행 — 실패도 결과로 돌려준다(렌더 실패를 검증하는 테스트가 있다). */
function helmTemplate(args) {
  const r = spawnSync('helm', ['template', 'smart-workplace', CHART, '-n', 'smart-workplace', ...args], {
    encoding: 'utf8',
  });
  if (r.error) throw r.error;
  return { ok: r.status === 0, out: r.stdout, err: r.stderr };
}

/** 운영 값(values.prod.yaml) 위에 extra 를 얹어 렌더한다. */
const render = (...extra) => helmTemplate(['-f', PROD_VALUES, ...extra]);

/** 렌더 결과를 `kind/name` → 문서 본문으로 나눈다. */
function docs(out) {
  const map = new Map();
  for (const body of out.split(/^---$/m)) {
    const kind = body.match(/^kind: (\S+)$/m)?.[1];
    const name = body.match(/^metadata:\n(?:  .*\n)*?  name: (\S+)$/m)?.[1];
    if (kind && name) map.set(`${kind}/${name}`, body);
  }
  return map;
}

const workloads = (map) => [...map].filter(([k]) => /^(Deployment|StatefulSet)\//.test(k));

// 정상 렌더는 한 번만 하고 여러 테스트가 나눠 본다. 표식 값(Secret 이름·릴리스 정보)을 함께 넣어
// Secret 이름이 values 를 따라 모든 템플릿에 흐르는지, 릴리스 정보가 어디에도 새지 않는지를 같은 결과로 확인한다.
const SECRET = 'swp-secret-sentinel';
const RELEASE = { version: '9.8.7-guard', commit: 'feedfacecafe' };
const BASE = render('-f', IMAGES, '--set', `existingSecret=${SECRET}`,
  '--set', `release.version=${RELEASE.version}`, '--set', `release.commit=${RELEASE.commit}`);
const BASE_DOCS = docs(BASE.out);
// 고정값 파일의 앱 id = 워크로드 수(앱 8개 + db)
const APP_IDS = [...readFileSync(IMAGES, 'utf8').matchAll(/^  ([\w-]+):/gm)].map((m) => m[1]);

test('정상 값으로 렌더된다', () => {
  assert.ok(BASE.ok, BASE.err);
});

test('이미지는 카탈로그 저장소의 digest 로만 렌더된다', () => {
  const images = [...BASE.out.matchAll(/^\s+image: "?([^"\s]+)"?$/gm)].map((m) => m[1]);
  // 앱 컨테이너 + init 2개(api 볼륨 권한 busybox, db pgdata 권한). busybox 만 공개 이미지 — 그것도 digest 로 고정.
  assert.equal(images.length, APP_IDS.length + 2);
  for (const image of images) {
    assert.match(image, /^(docker\.io\/iacloudops\/genia-works-[a-z-]+|busybox:[\w.]+)@sha256:[0-9a-f]{64}$/);
  }
  assert.doesNotMatch(BASE.out, /imagePullPolicy: Always/);
});

test('모든 워크로드 파드에 Docker Hub pull secret 이 들어간다', () => {
  const list = workloads(BASE_DOCS);
  assert.equal(list.length, APP_IDS.length);
  for (const [key, body] of list) {
    assert.match(body, /\n      imagePullSecrets:\n        - name: dockerhub-pull\n/, key);
  }
});

test('비밀값 Secret 은 차트가 만들지 않고 existingSecret 값으로만 참조한다', () => {
  assert.doesNotMatch(BASE.out, /^kind: Secret$/m);
  const refs = [...BASE.out.matchAll(/(?:secretRef|secretKeyRef):\n\s+(?:key: \S+\n\s+)?name: (\S+)/g)].map((m) => m[1]);
  assert.ok(refs.length > 0);
  assert.deepEqual([...new Set(refs)], [SECRET]);
});

test('api·worker 가 converter 서비스 주소를 받고 converter 는 api·worker 에게만 열린다', () => {
  for (const app of ['api', 'worker']) {
    assert.match(BASE_DOCS.get(`Deployment/${app}`), /- name: WORKPLACE_CONVERTER_URL\n\s+value: http:\/\/converter:7085\n/, app);
  }
  assert.ok(BASE_DOCS.has('Deployment/converter'));
  assert.match(BASE_DOCS.get('Service/converter'), /port: 7085/);
  assert.match(BASE_DOCS.get('NetworkPolicy/converter'), /values: \["api", "worker"\]/);
});

test('릴리스 버전·커밋은 렌더 결과 어디에도 들어가지 않는다(승계 앱이 재기동되지 않게)', () => {
  // 파드 템플릿·ConfigMap(체크섬 주석으로 파드를 굴릴 수 있다) 어느 쪽에 새도 잡히도록 렌더 전체에서 찾는다.
  assert.ok(!BASE.out.includes(RELEASE.version) && !BASE.out.includes(RELEASE.commit));
});

test('agentImages 는 api 의 AGENT_RUNTIME_IMAGES 로 쉼표로 이어 들어가고, 없으면 환경변수를 두지 않는다', () => {
  const a = `docker.io/iacloudops/genia-works-agent-codex@sha256:${'a'.repeat(64)}`;
  const b = `docker.io/iacloudops/genia-works-agent-opencode@sha256:${'b'.repeat(64)}`;
  const r = render('-f', IMAGES, '--set', `agentImages={${a},${b}}`);
  assert.ok(r.ok, r.err);
  const api = docs(r.out).get('Deployment/api');
  assert.match(api, new RegExp(`- name: AGENT_RUNTIME_IMAGES\\n\\s+value: "${a},${b}"`));
  assert.doesNotMatch(BASE_DOCS.get('Deployment/api'), /AGENT_RUNTIME_IMAGES/);
});

test('agentPluginVersion 은 api 의 AGENT_PLUGIN_VERSION 으로 들어가고, 비면 환경변수를 두지 않는다 (WP-1707)', () => {
  const r = render('-f', IMAGES, '--set-string', 'agentPluginVersion=0.1.53');
  assert.ok(r.ok, r.err);
  assert.match(docs(r.out).get('Deployment/api'), /- name: AGENT_PLUGIN_VERSION\n\s+value: "0\.1\.53"/);
  // 옛 매니페스트(플러그인 버전 없음)로 반영하면 값이 비어 env 가 없다 — API 는 최신을 모르는 것으로 보고 판정하지 않는다.
  assert.doesNotMatch(BASE_DOCS.get('Deployment/api'), /AGENT_PLUGIN_VERSION/);
});

test('api 는 파드 IP 를 AGENT_SCREEN_POD_ADDRESS 로 받고 application.yml 이 같은 이름을 읽는다 — 작업 화면 파드 사이 잇기 (WP-1978)', () => {
  const api = BASE_DOCS.get('Deployment/api');
  assert.match(api, /- name: POD_IP\n\s+valueFrom:\n\s+fieldRef:\n\s+fieldPath: status\.podIP/);
  assert.match(api, /- name: AGENT_SCREEN_POD_ADDRESS\n\s+value: "?\$\(POD_IP\)"?/);
  // 쿠버네티스는 앞에 정의된 env 만 $(…) 로 풀므로 POD_IP 가 먼저 와야 한다.
  assert.ok(api.indexOf('name: POD_IP') < api.indexOf('name: AGENT_SCREEN_POD_ADDRESS'));
  const yml = readFileSync(fileURLToPath(new URL('../../../apps/workplace-api/src/main/resources/application.yml', import.meta.url)), 'utf8');
  assert.match(yml, /pod-address: \$\{AGENT_SCREEN_POD_ADDRESS:\}/);
});

test('이미지 값이 없으면 렌더가 실패한다(:latest 로 새지 않는다)', () => {
  const { ok, err } = render();
  assert.equal(ok, false);
  assert.match(err, /images\.\S+\.repository 값이 필요합니다/);
});

test('digest 자리에 태그를 넣으면 렌더가 실패한다', () => {
  const { ok, err } = render('-f', IMAGES, '--set', 'images.api.digest=latest');
  assert.equal(ok, false);
  assert.match(err, /images\.api\.digest 가 sha256:<64자 hex> 형식이 아닙니다/);
});

test('메일 서버 내부망 허용 목록은 api 가 ConfigMap 으로 받고 기본은 비어 있다(WP-740)', () => {
  assert.match(BASE_DOCS.get('ConfigMap/smart-workplace-config'), /MAIL_ALLOWED_INTERNAL_HOSTS: ""/);
});

test('모델 서버 주소 허용 목록은 api(ConfigMap)·ai-agent 가 같은 키로 받는다 — 운영은 사내 모델 서버 하나만(WP-596)', () => {
  assert.match(BASE_DOCS.get('ConfigMap/smart-workplace-config'), /MODEL_URL_ALLOWED_HOSTS: "genia-code-server\.iacloud\.kr"/);
  assert.match(
    BASE_DOCS.get('Deployment/ai-agent'),
    /name: MODEL_URL_ALLOWED_HOSTS\n\s+valueFrom:\n\s+configMapKeyRef:\n\s+name: smart-workplace-config\n\s+key: MODEL_URL_ALLOWED_HOSTS/,
  );
});

// 차트 기본값(운영 값 없이) 렌더 — 운영 외 설치에 사내 예외가 새지 않는지 본다.
const DEFAULT_DOCS = docs(helmTemplate(['-f', IMAGES]).out);

// 사설 CA 모델 서버용 추가 신뢰 CA — 값이 있을 때만 ConfigMap·마운트·NODE_EXTRA_CA_CERTS 가 생기고, 검증을 끄는 설정은 어디에도 없다.
test('aiAgent.extraCaCerts 를 채우면 ai-agent 가 그 CA 를 NODE_EXTRA_CA_CERTS 로 추가 신뢰한다', () => {
  const agent = BASE_DOCS.get('Deployment/ai-agent');
  assert.match(BASE_DOCS.get('ConfigMap/ai-agent-extra-ca'), /ca\.crt: \|\n\s+-----BEGIN CERTIFICATE-----/);
  assert.match(agent, /name: NODE_EXTRA_CA_CERTS\n\s+value: \/etc\/ssl\/extra-ca\/ca\.crt/);
  assert.match(agent, /mountPath: \/etc\/ssl\/extra-ca/);
  assert.doesNotMatch(BASE.out, /NODE_TLS_REJECT_UNAUTHORIZED/);
});

test('aiAgent.extraCaCerts 를 채우면 api 도 그 CA 를 GENIA_LOGIN_CA_CERT_FILE 로 신뢰한다', () => {
  const api = BASE_DOCS.get('Deployment/api');
  assert.match(api, /name: GENIA_LOGIN_CA_CERT_FILE\n\s+value: \/etc\/ssl\/extra-ca\/ca\.crt/);
  assert.match(api, /mountPath: \/etc\/ssl\/extra-ca/);
  assert.match(api, /name: ai-agent-extra-ca/);
});

test('api 가 읽는 Gen:iA CA 환경 변수 이름이 차트가 넣는 이름과 같다', () => {
  // 차트가 GENIA_LOGIN_CA_CERT_FILE 을 넣어도 application.yml 이 다른 이름을 읽으면 사설 CA 를 신뢰하지 못한다 — 두 이름을 함께 묶어 둔다.
  const yml = readFileSync(fileURLToPath(new URL('../../../apps/workplace-api/src/main/resources/application.yml', import.meta.url)), 'utf8');
  assert.match(yml, /ca-cert-file: \$\{GENIA_LOGIN_CA_CERT_FILE:\}/);
});

test('차트 기본값만으로는 모델 서버 허용 목록·추가 CA 가 비어 있다(운영 외 설치에 SSRF 예외가 새지 않게)', () => {
  assert.match(DEFAULT_DOCS.get('ConfigMap/smart-workplace-config'), /MODEL_URL_ALLOWED_HOSTS: ""/);
  assert.equal(DEFAULT_DOCS.has('ConfigMap/ai-agent-extra-ca'), false);
  assert.doesNotMatch(DEFAULT_DOCS.get('Deployment/ai-agent'), /name: NODE_EXTRA_CA_CERTS|name: extra-ca/);
  assert.doesNotMatch(DEFAULT_DOCS.get('Deployment/api'), /GENIA_LOGIN_CA_CERT_FILE|name: extra-ca/);
});

test('ConfigMap 을 읽는 api·ai-agent 는 설정 체크섬을 달아 설정만 바뀐 반영에도 다시 뜬다', () => {
  for (const name of ['api', 'ai-agent']) {
    assert.match(BASE_DOCS.get(`Deployment/${name}`), /checksum\/config: [0-9a-f]{64}/, name);
  }
  const changed = docs(render('-f', IMAGES, '--set', 'config.modelUrlAllowedHosts=other.example').out);
  const sum = (m, n) => m.get(`Deployment/${n}`).match(/checksum\/config: (\w+)/)[1];
  for (const name of ['api', 'ai-agent']) assert.notEqual(sum(changed, name), sum(BASE_DOCS, name), name);
  // ai-agent 는 자기가 읽는 값만 해시한다 — 무관한 설정 변경으로는 다시 뜨지 않는다
  const unrelated = docs(render('-f', IMAGES, '--set', 'config.pushSubject=mailto:other@example.com').out);
  assert.equal(sum(unrelated, 'ai-agent'), sum(BASE_DOCS, 'ai-agent'));
  assert.notEqual(sum(unrelated, 'api'), sum(BASE_DOCS, 'api'));
});

// WP-1407: 반복 AI 작업 회차 상한(ai-agent)과 결과 대기(api)가 기본값으로 렌더되고, 값을 바꾸면 그대로 따라간다.
test('ai-agent 는 반복 상한 env 두 개(30분·60턴), api 는 결과 대기 env(PT40M)를 기본값으로 받는다', () => {
  const agent = BASE_DOCS.get('Deployment/ai-agent');
  assert.match(agent, /- name: WORKPLACE_AI_RECURRING_TIMEOUT_MS\n\s+value: "1800000"\n/);
  assert.match(agent, /- name: WORKPLACE_AI_RECURRING_MAX_TURNS\n\s+value: "60"\n/);
  assert.match(BASE_DOCS.get('Deployment/api'), /- name: WORKPLACE_RECURRENCE_PENDING_TIMEOUT\n\s+value: "PT40M"\n/);
  // 차트 기본값만으로도 같다.
  assert.match(DEFAULT_DOCS.get('Deployment/ai-agent'), /- name: WORKPLACE_AI_RECURRING_TIMEOUT_MS\n\s+value: "1800000"\n/);
  assert.match(DEFAULT_DOCS.get('Deployment/api'), /- name: WORKPLACE_RECURRENCE_PENDING_TIMEOUT\n\s+value: "PT40M"\n/);
});

test('반복 상한·결과 대기 값을 바꾸면 env 가 따라간다', () => {
  const changed = docs(
    render('-f', IMAGES, '--set', 'aiAgent.recurringTimeoutMs=600000', '--set', 'aiAgent.recurringMaxTurns=40',
      '--set', 'api.recurrencePendingTimeout=PT15M').out,
  );
  assert.match(changed.get('Deployment/ai-agent'), /- name: WORKPLACE_AI_RECURRING_TIMEOUT_MS\n\s+value: "600000"\n/);
  assert.match(changed.get('Deployment/ai-agent'), /- name: WORKPLACE_AI_RECURRING_MAX_TURNS\n\s+value: "40"\n/);
  assert.match(changed.get('Deployment/api'), /- name: WORKPLACE_RECURRENCE_PENDING_TIMEOUT\n\s+value: "PT15M"\n/);
});

/** 인그레스의 호스트 규칙 하나를 `경로 → 서비스:포트` 목록으로 읽는다(렌더 YAML 을 그대로 줄 단위로 따라간다). */
function ingressPaths(out, host) {
  const ingress = docs(out).get('Ingress/smart-workplace');
  const rule = ingress.split(/\n    - host: /).find((r) => r.startsWith(`"${host}"`));
  assert.ok(rule, `호스트 ${host} 규칙이 없다`);
  return [...rule.matchAll(/- path: (\S+)\n\s+pathType: (\S+)\n\s+backend:\n\s+service:\n\s+name: (\S+)\n\s+port:\n\s+number: (\d+)/g)].map(
    ([, path, type, name, port]) => ({ path, type, backend: `${name}:${port}` }),
  );
}
const WEB_HOST = 'genia-works.iacloud.kr';
const MCP_HOST = 'genia-works-mcp.192.168.100.72.nip.io';
const AS_PATH = { path: '/.well-known/oauth-authorization-server', type: 'Prefix', backend: 'api:9090' };
const PR_PATH = { path: '/.well-known/oauth-protected-resource', type: 'Prefix', backend: 'mcp:7090' };

test('OAuth well-known 경로 — webHost·mcpHost 둘 다 인가 서버 메타데이터는 api, 보호 리소스 메타데이터는 mcp(WP-1685)', () => {
  for (const host of [WEB_HOST, MCP_HOST]) {
    const paths = ingressPaths(BASE.out, host);
    assert.deepEqual(paths.find((p) => p.path === AS_PATH.path), AS_PATH, host);
    assert.deepEqual(paths.find((p) => p.path === PR_PATH.path), PR_PATH, host);
  }
});

test('mcpPathOnWeb=false 면 webHost 에 보호 리소스 메타데이터는 없고 인가 서버 메타데이터는 남는다(WP-1685)', () => {
  const r = render('-f', IMAGES, '--set', 'ingress.mcpPathOnWeb=false');
  assert.ok(r.ok, r.err);
  const web = ingressPaths(r.out, WEB_HOST);
  assert.deepEqual(web.find((p) => p.path === AS_PATH.path), AS_PATH);
  assert.equal(web.find((p) => p.path === PR_PATH.path), undefined);
  assert.equal(web.find((p) => p.path === '/mcp'), undefined);
  const mcp = ingressPaths(r.out, MCP_HOST);
  assert.deepEqual(mcp.find((p) => p.path === PR_PATH.path), PR_PATH);
  assert.deepEqual(mcp.find((p) => p.path === AS_PATH.path), AS_PATH);
});

test('mcp 는 인가 서버 주소(WORKPLACE_OAUTH_ISSUER)로 config.webBaseUrl 을 받는다(WP-1685)', () => {
  assert.match(BASE_DOCS.get('Deployment/mcp'), /- name: WORKPLACE_OAUTH_ISSUER\n\s+value: "https:\/\/genia-works\.iacloud\.kr"\n/);
});

test('api DB 풀 크기는 ConfigMap DB_POOL_MAX_SIZE 로 들어가고 기본 10, 값을 바꾸면 따라간다 (WP-1972)', () => {
  assert.match(BASE_DOCS.get('ConfigMap/smart-workplace-config'), /DB_POOL_MAX_SIZE: "10"\n/);
  const r = render('-f', IMAGES, '--set', 'api.dbPoolMaxSize=20');
  assert.ok(r.ok, r.err);
  assert.match(docs(r.out).get('ConfigMap/smart-workplace-config'), /DB_POOL_MAX_SIZE: "20"\n/);
});

test('api 가 읽는 풀 크기 환경 변수 이름이 차트가 넣는 이름과 같다 (WP-1972)', () => {
  const yml = readFileSync(new URL('../../../apps/workplace-api/src/main/resources/application-prod.yml', import.meta.url), 'utf8');
  assert.match(yml, /maximum-pool-size: \$\{DB_POOL_MAX_SIZE:10\}/);
});

test('db 는 max_connections 를 args 로 받는다 — 기본 100, 값을 바꾸면 따라간다 (WP-1972)', () => {
  assert.match(BASE_DOCS.get('StatefulSet/db'), /args:\s*\n\s*- "?-c"?\n\s*- "?max_connections=100"?/);
  const r = render('-f', IMAGES, '--set', 'db.maxConnections=200');
  assert.ok(r.ok, r.err);
  assert.match(docs(r.out).get('StatefulSet/db'), /args:\s*\n\s*- "?-c"?\n\s*- "?max_connections=200"?/);
});

test('api 대수 × 풀 + 롤링 여유 + 예비가 max_connections 를 넘으면 렌더가 실패한다 (WP-1972)', () => {
  // (8+2)×10+2+13 = 115 > 100
  const { ok, err } = render('-f', IMAGES, '--set', 'appReplicas=8');
  assert.equal(ok, false);
  assert.match(err, /DB 커넥션 합계/);
  assert.match(err, /115/);
});

test('rollout.maxSurge 가 백분율이면 합계를 셀 수 없어 렌더가 실패한다 (WP-1972)', () => {
  const { ok, err } = render('-f', IMAGES, '--set-string', 'rollout.maxSurge=50%');
  assert.equal(ok, false);
  assert.match(err, /rollout\.maxSurge 는 DB 커넥션 합계 계산을 위해 정수여야 합니다/);
});

test('정수 문자열 maxSurge("1") 는 허용된다 (WP-1972)', () => {
  const r = render('-f', IMAGES, '--set-string', 'rollout.maxSurge=1');
  assert.ok(r.ok, r.err);
});

test('풀 크기만 키워도 합계가 넘으면 렌더가 실패한다 (WP-1972)', () => {
  // (1+2)×50+2+13 = 165 > 100
  const { ok, err } = render('-f', IMAGES, '--set', 'api.dbPoolMaxSize=50');
  assert.equal(ok, false);
  assert.match(err, /165/);
});

test('합계가 max_connections 와 같으면 렌더된다 (WP-1972)', () => {
  // (6+2)×10+18+Flyway 2×1 = 100
  const r = render('-f', IMAGES, '--set', 'appReplicas=6', '--set', 'db.reservedConnections=18');
  assert.ok(r.ok, r.err);
});

test('api.dbPoolMaxSize 가 숫자가 아니면 가드가 조용히 지나지 않고 렌더가 실패한다 (WP-1972)', () => {
  const { ok, err } = render('-f', IMAGES, '--set-string', 'api.dbPoolMaxSize=20x');
  assert.equal(ok, false);
  assert.match(err, /api\.dbPoolMaxSize/);
});

test('appReplicas 가 정수가 아니면(8x) int 가 0 으로 읽어 합계를 적게 세므로 렌더가 실패한다 (WP-1972)', () => {
  const { ok, err } = render('-f', IMAGES, '--set-string', 'appReplicas=8x');
  assert.equal(ok, false);
  assert.match(err, /appReplicas 는 DB 커넥션 합계 계산을 위해 정수여야 합니다/);
});

test('api.dbPoolMaxSize=0 은 거절한다 — Hikari 는 1 미만이면 기본 10 을 써서 가드가 0 으로 세는 동안 파드마다 10 개를 연다 (WP-1972)', () => {
  const { ok, err } = render('-f', IMAGES, '--set', 'api.dbPoolMaxSize=0');
  assert.equal(ok, false);
  assert.match(err, /api\.dbPoolMaxSize 는 1 이상/);
});

// Flyway 접속 몫(maxSurge × 2)이 합계에 들어가고 maxSurge 에 비례해 는다 — 예비 13 + 풀 1 일 때
// maxSurge 1: (1+2)×1+2+13 = 18, maxSurge 3: (1+6)×1+6+13 = 26. Flyway 몫을 안 세면 각각 16·20 이라 한계-1 에서 통과해 버린다
for (const [surge, limit] of [[1, 18], [3, 26]]) {
  test(`Flyway 접속 몫이 합계에 들어간다 — maxSurge ${surge} 이면 합계 ${limit} (WP-1972)`, () => {
    const base = ['-f', IMAGES, '--set', 'api.dbPoolMaxSize=1', '--set', 'db.reservedConnections=13', '--set', `rollout.maxSurge=${surge}`];
    const low = render(...base, '--set', `db.maxConnections=${limit - 1}`);
    assert.equal(low.ok, false);
    assert.match(low.err, new RegExp(`DB 커넥션 합계 ${limit} `));
    assert.ok(render(...base, '--set', `db.maxConnections=${limit}`).ok);
  });
}

test('api 볼륨 권한 init 컨테이너는 표식 파일이 있을 때 전체 chown 을 건너뛴다(WP-1981)', () => {
  const api = BASE_DOCS.get('Deployment/api');
  assert.ok(api, 'Deployment/api 렌더 없음');
  // 검사는 fix-storage-perms init 컨테이너 블록만 잘라 그 안에서 — 문서 전체 기준이면 미래 템플릿이
  // 앞에 literal else 를 내면 옳은 코드가 잘못 실패한다(시작부터 다음 containers: 까지의 구간)
  const start = api.indexOf('fix-storage-perms');
  assert.ok(start >= 0, 'fix-storage-perms init 컨테이너 없음');
  const end = api.indexOf('containers:', start);
  assert.ok(end > start, 'fix-storage-perms 뒤의 containers: 없음 — 블록 끝을 찾지 못했다');
  const block = api.slice(start, end);
  // 표식 없을 때만 전체 chown — 표식이 있으면 루트 디렉터리 하나만 맞춘다(파일 수와 무관한 기동)
  assert.match(block, /if \[ ! -e \/data\/storage-data\/\.perms-fixed \]/);
  assert.match(block, /chown -R 65532:65532 \/data\/storage-data/);
  assert.match(block, /touch \/data\/storage-data\/\.perms-fixed/);
  assert.match(block, /else\s+chown 65532:65532 \/data\/storage-data\s+fi/);
  // 전체 chown 은 표식 가드 안에 딱 한 번만 나온다
  assert.equal(block.match(/chown -R/g).length, 1);
  assert.ok(block.indexOf('if [ ! -e') < block.indexOf('chown -R'));
  // then 블록 안(else 보다 앞) — fi 뒤로 빠진 조건 없는 chown -R 회귀를 잡는다(WP-1981)
  assert.ok(block.indexOf('chown -R') < block.indexOf('else'));
  // then 블록 안에서 chown -R 이 touch 보다 앞서야 한다 — touch 가 먼저면 실패 시 표식이 남아 무음으로 깨진다
  assert.ok(block.indexOf('chown -R') < block.indexOf('touch'));
});

// WP-1971 — 앱별 복제 수·PDB·분산 배치. appReplicas 로 함께 움직이는 여섯 앱(전환·db 는 빠진다).
const SIX_APPS = ['api', 'ai-agent', 'web', 'admin', 'mcp', 'worker'];

test('기본값에서는 여섯 앱이 모두 appReplicas(1)대로 렌더된다 (WP-1971)', () => {
  for (const name of SIX_APPS) {
    assert.match(BASE_DOCS.get(`Deployment/${name}`), /^\s+replicas: 1$/m, name);
  }
});

test('appReplicas 만 바꾸면 앱별 값이 없는 앱이 따라 움직인다 (WP-1971)', () => {
  const r = render('-f', IMAGES, '--set', 'appReplicas=3');
  assert.ok(r.ok, r.err);
  for (const name of SIX_APPS) {
    assert.match(docs(r.out).get(`Deployment/${name}`), /^\s+replicas: 3$/m, name);
  }
});

test('앱별 복제 수는 그 앱만 바꾸고 나머지는 appReplicas 를 쓴다 (WP-1971 완료 조건 1)', () => {
  const r = render('-f', IMAGES, '--set', 'web.replicas=2', '--set', 'admin.replicas=2',
    '--set', 'mcp.replicas=2', '--set', 'worker.replicas=2');
  assert.ok(r.ok, r.err);
  const d = docs(r.out);
  for (const name of ['web', 'admin', 'mcp', 'worker']) assert.match(d.get(`Deployment/${name}`), /^\s+replicas: 2$/m, name);
  for (const name of ['api', 'ai-agent']) assert.match(d.get(`Deployment/${name}`), /^\s+replicas: 1$/m, name);
});

test('appReplicas=0 동결은 앱별 값을 이기고, 앱별 값이 정수가 아니면 렌더가 실패한다 (WP-1971)', () => {
  const frozen = render('-f', IMAGES, '--set', 'appReplicas=0', '--set', 'web.replicas=2');
  assert.ok(frozen.ok, frozen.err);
  for (const name of SIX_APPS) {
    assert.match(docs(frozen.out).get(`Deployment/${name}`), /^\s+replicas: 0$/m, name);
  }
  const bad = render('-f', IMAGES, '--set-string', 'api.replicas=8x');
  assert.equal(bad.ok, false);
  assert.match(bad.err, /api\.replicas 는 정수여야 합니다/);
});

test('기본값(1대)에서는 PDB 와 분산 배치가 하나도 렌더되지 않는다 (WP-1971)', () => {
  assert.equal([...BASE_DOCS.keys()].filter((k) => k.startsWith('PodDisruptionBudget/')).length, 0);
  for (const name of SIX_APPS) {
    assert.doesNotMatch(BASE_DOCS.get(`Deployment/${name}`), /topologySpreadConstraints/, name);
  }
});

test('두 대가 된 앱에만 PDB(minAvailable 1)와 노드 분산 배치가 렌더된다 (WP-1971)', () => {
  const r = render('-f', IMAGES, '--set', 'web.replicas=2', '--set', 'admin.replicas=2',
    '--set', 'mcp.replicas=2', '--set', 'worker.replicas=2');
  assert.ok(r.ok, r.err);
  const d = docs(r.out);
  const pdbs = [...d.keys()].filter((k) => k.startsWith('PodDisruptionBudget/'));
  assert.deepEqual(pdbs.sort(), ['PodDisruptionBudget/admin', 'PodDisruptionBudget/mcp',
    'PodDisruptionBudget/web', 'PodDisruptionBudget/worker']);
  for (const name of ['admin', 'mcp', 'web', 'worker']) {
    const pdb = d.get(`PodDisruptionBudget/${name}`);
    assert.match(pdb, /minAvailable: 1/);
    assert.match(pdb, new RegExp(`app: ${name}\\n`));
    const dep = d.get(`Deployment/${name}`);
    assert.match(dep, /topologySpreadConstraints:/);
    assert.match(dep, /topologyKey: kubernetes\.io\/hostname/);
    assert.match(dep, /whenUnsatisfiable: ScheduleAnyway/);
    assert.match(dep, /maxSkew: 1/);
  }
  for (const name of ['api', 'ai-agent']) assert.doesNotMatch(d.get(`Deployment/${name}`), /topologySpreadConstraints/);
});

test('분산 배치는 노드가 한 대여도 스케줄을 거부하지 않는다 — ScheduleAnyway (WP-1971)', () => {
  const r = render('-f', IMAGES, '--set', 'web.replicas=2');
  assert.ok(r.ok, r.err);
  const web = docs(r.out).get('Deployment/web');
  assert.match(web, /whenUnsatisfiable: ScheduleAnyway/);
  assert.doesNotMatch(web, /whenUnsatisfiable: DoNotSchedule/);
  assert.match(web, /app: web\n/);   // labelSelector 는 Deployment selector 와 같은 app 라벨
});

test('aiAgent 값 키로 ai-agent 만 바뀐다 — 값 키와 이름이 다른 유일한 앱 (WP-1971)', () => {
  const r = render('-f', IMAGES, '--set', 'aiAgent.replicas=2');
  assert.ok(r.ok, r.err);
  const d = docs(r.out);
  assert.match(d.get('Deployment/ai-agent'), /^\s+replicas: 2$/m);
  assert.match(d.get('PodDisruptionBudget/ai-agent'), /minAvailable: 1/);
  for (const name of ['api', 'web', 'admin', 'mcp', 'worker']) {
    assert.match(d.get(`Deployment/${name}`), /^\s+replicas: 1$/m, name);
  }
});

test('기본값 렌더의 여섯 앱 pod spec 에 공백 전용 줄이 늘지 않는다 — 완료 조건 2 (WP-1971)', () => {
  for (const name of SIX_APPS) {
    const body = BASE_DOCS.get(`Deployment/${name}`);
    // pod spec 의 공백 전용 줄은 imagePullSecrets 헬퍼(nindent)가 남기는 1개뿐이어야 한다.
    // 빈 출력에 `| nindent 6` 을 단 swp.spread include 가 돌아오면(1대) 앱마다 2개가 된다 —
    // 완료 조건 2 「기본값 렌더링 결과는 지금과 같다」를 공백 줄 수로 잡는다.
    assert.equal((body.match(/^ +$/gm) || []).length, 1, name);
  }
});

test('DB 커넥션 가드는 appReplicas 가 아니라 api 앱별 복제 수로 센다 (WP-1971)', () => {
  // api 는 1 그대로, web 을 2로 올려도 합계는 변하지 않는다
  assert.ok(render('-f', IMAGES, '--set', 'web.replicas=2').ok);
  // api=8 → (8+2)×10+2+13 = 115 > 100
  const { ok, err } = render('-f', IMAGES, '--set', 'api.replicas=8');
  assert.equal(ok, false);
  assert.match(err, /DB 커넥션 합계/);
  assert.match(err, /115/);
  // appReplicas 6 이어도 api 만 2 면 (2+2)×10+2+13 = 55 ≤ 100 로 통과 — 가드는 api 값을 센다
  assert.ok(render('-f', IMAGES, '--set', 'appReplicas=6', '--set', 'api.replicas=2').ok);
});

// 스펙 §6 차트 테스트 표에서 아직 안 쓴 줄 세 개(WP-1971): 롤아웃 전략, api.replicas=0, 동결의 converter·collab.

test('여섯 앱 모두 RollingUpdate 로 maxSurge·maxUnavailable 값을 쓰고 ai-agent 는 Recreate 가 아니다 (WP-1971)', () => {
  // 기본(운영 값 + images) 렌더: values.yaml 기본 maxSurge 1 / maxUnavailable 0 이 그대로 나와야 한다.
  const base = /strategy:\n\s+type: RollingUpdate\n\s+rollingUpdate:\n\s+maxSurge: 1\n\s+maxUnavailable: 0\n/;
  for (const name of SIX_APPS) {
    const body = BASE_DOCS.get(`Deployment/${name}`);
    assert.ok(body, `Deployment/${name} 렌더 없음`);
    assert.match(body, base, name);
    assert.doesNotMatch(body, /type: Recreate/, name);
  }
  // 값을 바꾸면 여섯 앱 모두 따라간다.
  const r = render('-f', IMAGES, '--set', 'rollout.maxSurge=2', '--set', 'rollout.maxUnavailable=1');
  assert.ok(r.ok, r.err);
  const changed = /strategy:\n\s+type: RollingUpdate\n\s+rollingUpdate:\n\s+maxSurge: 2\n\s+maxUnavailable: 1\n/;
  for (const name of SIX_APPS) assert.match(docs(r.out).get(`Deployment/${name}`), changed, name);
  // collab 은 문서 상태를 메모리에 들고 있어 유일하게 Recreate — 두 파드가 같은 문서를 덮어쓰지 않게(_helpers.tpl 주석과 일치).
  assert.match(BASE_DOCS.get('Deployment/collab'), /type: Recreate/);
});

test('api.replicas=0 + appReplicas=1 이면 api 는 0, web 은 1 그대로 렌더된다 (WP-1971)', () => {
  const r = render('-f', IMAGES, '--set', 'appReplicas=1', '--set', 'api.replicas=0');
  assert.ok(r.ok, r.err);
  const d = docs(r.out);
  assert.match(d.get('Deployment/api'), /^\s+replicas: 0$/m, 'api');
  assert.match(d.get('Deployment/web'), /^\s+replicas: 1$/m, 'web');
});

test('appReplicas=0 동결은 converter·collab 에도 흐른다 (WP-1971)', () => {
  // 두 앱은 swp.replicas 를 쓰지 않지만 appReplicas=0(신규 클러스터 이관)에서 함께 0 이어야 한다.
  const r = render('-f', IMAGES, '--set', 'appReplicas=0');
  assert.ok(r.ok, r.err);
  const d = docs(r.out);
  assert.match(d.get('Deployment/converter'), /^\s+replicas: 0$/m, 'converter');
  assert.match(d.get('Deployment/collab'), /^\s+replicas: 0$/m, 'collab');
});
