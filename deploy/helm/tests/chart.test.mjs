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
function render(...extra) {
  const r = spawnSync('helm', ['template', 'smart-workplace', CHART, '-n', 'smart-workplace', '-f', PROD_VALUES, ...extra], {
    encoding: 'utf8',
  });
  if (r.error) throw r.error;
  return { ok: r.status === 0, out: r.stdout, err: r.stderr };
}

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

test('모델 서버 주소 허용 목록은 api(ConfigMap)·ai-agent 가 같은 키로 받고 기본은 비어 있다(WP-596)', () => {
  assert.match(BASE_DOCS.get('ConfigMap/smart-workplace-config'), /MODEL_URL_ALLOWED_HOSTS: ""/);
  assert.match(
    BASE_DOCS.get('Deployment/ai-agent'),
    /name: MODEL_URL_ALLOWED_HOSTS\n\s+valueFrom:\n\s+configMapKeyRef:\n\s+name: smart-workplace-config\n\s+key: MODEL_URL_ALLOWED_HOSTS/,
  );
});
