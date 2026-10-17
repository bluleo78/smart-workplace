#!/usr/bin/env node
// 릴리스 반영·롤백·상태 확인 CLI (WP-443).
//   node deploy/release/release.mjs deploy <x.y.z> [--manifest <file>] [--current <x.y.z>] [--yes] [--force]
//   node deploy/release/release.mjs rollback [--yes] [--force]
//   node deploy/release/release.mjs status [--manifest <file>]
//   공통: --context <kube context, 기본 iacloud-prod-public>  --namespace <기본 smart-workplace>
//
// deploy   릴리스 태그 지점의 차트(git archive v<버전> deploy/helm)와 매니페스트의 digest 고정 이미지로 `helm upgrade --install` 한다.
//          반영 전 배포 체크리스트(checklist.mjs)를 보여 주고 ⚠ 항목이 있으면 확인을 묻는다(--yes 면 생략). 반영 뒤 파드 digest·앱 버전을 확인해
//          하나라도 어긋나면 종료 코드 1 + 롤백 안내만 한다(자동 롤백 없음 — 스키마가 되돌아가지 않아 사람이 판단한다).
// rollback 마지막 정상(`deployed`) 리비전으로 `helm rollback` — 실패한 반영이 위에 얹혀 있으면 그 deployed 로 복구하고, 아니면 바로 앞 superseded 로 간다.
//          대상이 전환 이전 리비전(release.version 없음)이면 --force 없이는 거부, 두 릴리스 사이에 마이그레이션이 있으면 「스키마는 되돌아가지 않는다」 경고 후 확인.
// status   운영 중인(deployed) 리비전·릴리스와 앱별 「매니페스트 digest ↔ 실행 digest」 표(stdout). 실패·진행 중 시도가 위에 있으면 ⚠.
//
// 「지금 운영 릴리스」 = helm history 에서 가장 높은 `deployed` 리비전. 실패한 `upgrade --wait` 는 새 리비전을 `failed` 로 남기고 직전 리비전을 `deployed` 로 둔다.
// `helm get values` 는 --revision 없이 부르면 status 와 무관하게 「가장 마지막」 리비전을 주므로 항상 --revision 을 명시한다.
//
// 모든 helm 호출에 --kube-context, kubectl 호출에 --context 를 명시한다(노트북의 현재 컨텍스트는 PoC 라 기대지 않는다).
// `helm get values` 결과에는 옛 리비전의 secrets.* 가 들어 있을 수 있어 release 키만 꺼내 쓰고 출력·오류 메시지에 values 를 남기지 않는다.
// 종료 코드: 0 = 성공, 1 = 실패·거부(사유는 stderr `오류: …`). 진행 로그는 stderr(log), 체크리스트·상태 표는 stdout.
// 위치 인자는 엄격하다: deploy 는 정확히 1개(버전), rollback·status 는 0개 — 입력과 다른 동작이 실행되지 않게 남는 인자는 helm·kubectl 호출 전에 거부한다.
// helm 자신의 stdout(릴리스 요약 등)은 stderr 로 보낸다 — 위 stdout 계약(체크리스트·상태 표 전용)을 지킨다.
// 필요 환경: 매니페스트를 GitLab 패키지에서 받을 때 CI_API_V4_URL · CI_PROJECT_ID · GITLAB_TOKEN. deploy --manifest <파일> 이면 필요 없다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir as osTmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { main as checklistMain } from './checklist.mjs';
import { SHA_RE, assertVersion, defaultExec, validateBaseManifest } from './lib/build.mjs';
import { isPlainObject, loadCatalog } from './lib/catalog.mjs';
import { isMainModule, tolerate, withTempDir } from './lib/cli.mjs';
import { checkDigests, currentRelease, hasWarnings, imageValues, parseVersionResponse, renderStatus, revisionModel, rollbackPlan, runningDigests } from './lib/deploy.mjs';
import { downloadManifest } from './lib/manifest-store.mjs';
import { compareVersions, parseVersion } from './lib/semver.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RELEASE_NAME = 'smart-workplace';
const DEFAULT_CONTEXT = 'iacloud-prod-public';
const DEFAULT_NAMESPACE = 'smart-workplace';
const HELM_TIMEOUT = '15m';
const SELF = 'node deploy/release/release.mjs';
/** 클러스터에 미리 있어야 하는 Secret (deploy/helm/README.md 「클러스터에 미리 있어야 하는 Secret」). genia-works-tls 는 cert-manager 가 발급하므로 미리 요구하지 않는다. */
const REQUIRED_SECRETS = ['smart-workplace-secrets', 'dockerhub-pull', 'genia-works-internal-tls'];
/** 앱 비밀값 Secret — 첫 전환 전에는 Helm 이 소유(만들고 지우는)했다. */
const APP_SECRETS = 'smart-workplace-secrets';
/** Helm 소유 표시 주석 — 남아 있으면 아직 Helm 릴리스 소속이다(README 인계 2단계에서 뗀다). */
const HELM_OWNER_ANNOTATION = 'meta.helm.sh/release-name';
/** 이 주석이 `keep` 이어야 Helm 이 (차트에서 빠진) Secret 을 지우지 않는다 — 소유 주석 유무와 무관하게 Helm 은 지우기 직전 이 주석을 본다(README 인계 1단계). */
const HELM_KEEP_ANNOTATION = 'helm.sh/resource-policy';
const SCHEMA_WARNING = '스키마(DB 마이그레이션)는 롤백으로 되돌아가지 않는다 — 앱만 옛 버전이 되어 새 스키마와 어긋날 수 있다.';

/** 앱 버전을 읽는 곳 — 서비스 프록시 경로(서비스:포트/경로)와 응답 종류. 나머지 앱은 digest 만 본다. */
export const VERSION_ENDPOINTS = [
  { id: 'api', service: 'api', port: 9090, path: 'actuator/info', kind: 'actuator' },
  { id: 'web', service: 'web', port: 80, path: 'version.json', kind: 'version-json' },
  { id: 'admin', service: 'admin', port: 80, path: 'version.json', kind: 'version-json' },
];

/** 터미널에서 y/N 을 묻는다. TTY 가 없으면(CI·파이프) 임의로 승인하지 않고 거부 — 사람이 보지 않는 곳에서는 --yes 를 명시해야 한다. stdin 은 테스트가 바꿔 끼운다. */
export async function ttyConfirm(question, { stdin = process.stdin } = {}) {
  if (!stdin.isTTY) throw new Error('확인을 물어야 하는데 터미널(TTY)이 아니다. 내용을 검토했다면 --yes 로 다시 실행하라');
  const rl = createInterface({ input: stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

/** helm·kubectl 호출 도우미 — 컨텍스트·네임스페이스를 한 곳에서 붙여 빠뜨리지 않게 한다. 컨텍스트·네임스페이스 자체가 필요한 곳(안내 문구)은 ctx 에서 읽는다. */
function makeClusterTools({ exec, context, namespace }) {
  const helm = (args, opts) => exec('helm', [...args, '-n', namespace, '--kube-context', context], opts).stdout;
  const kubectl = (args, opts) => exec('kubectl', ['--context', context, ...args], opts).stdout;
  /** JSON 출력을 파싱한다. 실패 시 원문 조각이 든 기본 메시지 대신 고정 문구만 던진다(values 의 비밀값이 오류로 새지 않게). */
  const parseJson = (text, what) => {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${what} 출력이 JSON 이 아니다`);
    }
  };
  return {
    /** 출력을 그대로 보이는 긴 helm 작업(upgrade·rollback) — 자식의 stdout 은 stderr 로 돌려 우리 stdout 계약을 지킨다. */
    helmLive: (args) => helm(args, { capture: false, toStderr: true }),
    /** 리비전 이력. 릴리스가 아직 없으면(helm 의 「release: not found」) 빈 배열 — 첫 설치도 `deploy --current` 로 진행할 수 있게 한다. */
    history: () => {
      let text;
      try {
        text = helm(['history', RELEASE_NAME, '-o', 'json']);
      } catch (err) {
        if (/release: not found/i.test(err.message)) return [];
        throw err;
      }
      const history = parseJson(text, 'helm history');
      if (!Array.isArray(history)) throw new Error('helm history 출력이 배열이 아니다');
      return history;
    },
    /** Secret 의 metadata 만 읽는다(jsonpath) — `-o json|yaml` 은 `data`(비밀값)까지 가져오므로 쓰지 않는다. 내용은 출력·로그에 남기지 않는다. */
    secretMetadata: (name) => parseJson(kubectl(['-n', namespace, 'get', 'secret', name, '-o', 'jsonpath={.metadata}']), `kubectl get secret ${name}`),
    /** 리비전의 `{ version, commit }` | null. values 전체는 이 함수 밖으로 나가지 않는다. 리비전은 필수 — 생략형은 실패한 마지막 리비전을 돌려줘 「현재」를 잘못 읽게 한다. */
    release: (revision) => {
      if (!Number.isInteger(revision)) throw new Error(`helm get values 에는 리비전 번호가 필요하다: ${revision}`);
      return currentRelease(parseJson(helm(['get', 'values', RELEASE_NAME, '--revision', String(revision), '-o', 'json']), 'helm get values'));
    },
    /**
     * 네임스페이스의 파드를 한 번에 읽어(`get pods -o json` 한 호출) `metadata.labels.app` 별로 묶는다 — 앱 id → `{ items }` 인 Map.
     * 앱마다 호출하면 느리고 호출 사이에 롤링이 진행되어 앱별 스냅샷이 서로 다른 시점이 된다. app 라벨이 없는 파드는 어느 앱에도 속하지 않아 버린다.
     */
    podsByApp: () => {
      const all = parseJson(kubectl(['-n', namespace, 'get', 'pods', '-o', 'json']), 'kubectl get pods');
      const byApp = new Map();
      for (const pod of Array.isArray(all?.items) ? all.items : []) {
        const app = pod?.metadata?.labels?.app;
        if (typeof app !== 'string' || app === '') continue;
        if (!byApp.has(app)) byApp.set(app, { items: [] });
        byApp.get(app).items.push(pod);
      }
      return byApp;
    },
    /** API 서버의 서비스 프록시로 읽는 읽기 전용 GET — 응답 본문(문자열). */
    proxyGet: ({ service, port, path }) => kubectl(['get', '--raw', `/api/v1/namespaces/${namespace}/services/${service}:${port}/proxy/${path}`]),
  };
}

const describeRelease = (release) => (release === null ? '전환 이전 — release 정보 없음' : `${release.version}${release.commit ? ` ${release.commit.slice(0, 12)}` : ''}`);

/**
 * 매니페스트를 파일(`file`, --manifest) 또는 GitLab 패키지(`download(version)`)에서 읽는다. 패키지에 없으면(404) null.
 * 파일 읽기·JSON 오류는 SyntaxError 그대로가 아니라 `--manifest 파일을 읽지 못했다 (…)` 로 감싼다. 모양 검사는 호출자 몫이다(deploy 는 엄격, status 는 관대).
 */
async function readManifest({ file, version, download }) {
  if (!file) return (await download(version)) ?? null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`--manifest 파일을 읽지 못했다 (${err instanceof SyntaxError ? 'JSON 이 아니다' : err.message})`);
  }
}

/**
 * 반영할 릴리스 매니페스트를 구하고 검증한다 — 없으면 throw. 모양(schemaVersion·version·images·digest)과 「태그 v<버전> 의 커밋 == 매니페스트 commit」은
 * build-images 의 기준 매니페스트 검증(validateBaseManifest)을 그대로 쓴다: 반영하는 이미지(매니페스트)와 차트(태그 지점)가 같은 커밋에서 나와야 한다.
 */
async function loadTargetManifest({ version, file, ctx }) {
  const { repoRoot, exec, download } = ctx;
  const manifest = await readManifest({ file, version, download });
  if (manifest === null) throw new Error(`릴리스 ${version} 의 매니페스트를 찾지 못했다 (build-images --upload 를 했는지, --manifest <파일> 로 직접 줄 수 있다)`);
  // commit 이 없거나 40자 hex 가 아니면 비교할 수 없으니 건너뛰지 않고 태그 조회 전에 거부한다(validateBaseManifest 는 commit 형식을 따로 보지 않는다).
  if (typeof manifest.commit !== 'string' || !SHA_RE.test(manifest.commit)) {
    throw new Error(`매니페스트의 commit 이 40자 hex 가 아니다(${JSON.stringify(manifest.commit)}) — 차트와 이미지가 같은 커밋인지 확인할 수 없어 반영하지 않는다`);
  }
  validateBaseManifest({ manifest, baseVersion: version, exec, repoRoot, source: '릴리스 매니페스트' });
  return manifest;
}

/** 이 태그에 저장소 차트가 있어야 반영할 수 있다 — 전환 이전 릴리스(~/k8s 로 반영하던 때)는 차트가 없어 git archive 가 raw 오류로 죽는다. */
function assertChartAtTag({ version, ctx }) {
  try {
    ctx.exec('git', ['cat-file', '-e', `v${version}:deploy/helm/Chart.yaml`], { cwd: ctx.repoRoot });
  } catch {
    throw new Error(`v${version} 에는 저장소 차트가 없다(전환 이전 릴리스) — 이 도구로 반영할 수 없다. 전환 되돌리기는 deploy/helm/README.md 참고`);
  }
}

/**
 * 반영 뒤 확인 — 앱별 파드 digest 와 api·web·admin 의 앱 버전이 매니페스트와 같은지 본다. 실패 사유 문자열의 배열(비면 통과).
 * 옛 이미지의 응답(index.html·`{}`·빈 값)이나 프록시 오류는 예외로 죽지 않고 「버전 정보 없음」 실패로 모은다.
 */
function verifyDeployment({ manifest, tools, log }) {
  const failures = [];
  /** 실패를 모으고 진행 로그에 한 줄 남긴다 — 로그는 짧게(short), 모은 사유는 자세히(detail). */
  const fail = (id, detail, short = detail) => {
    failures.push(`${id}: ${detail}`);
    log(`  실패 ${id.padEnd(9)} ${short}`);
  };
  /** 앱 버전 확인 — 문제 문구 | null(일치). */
  const checkVersion = (ep) => {
    let actual;
    try {
      actual = parseVersionResponse(tools.proxyGet(ep), ep.kind);
    } catch (err) {
      return `응답을 읽지 못했다 (${err.message})`;
    }
    const expected = manifest.images[ep.id].builtVersion;
    if (actual === null) return '버전 정보 없음 (옛 이미지이거나 응답이 JSON 이 아니다)';
    if (actual !== expected) return `앱 버전 ${actual} 이(가) 매니페스트의 ${expected} 와 다르다`;
    return null;
  };

  for (const r of checkDigests({ manifest, podsByApp: tools.podsByApp() })) {
    if (r.ok) log(`  OK   ${r.id.padEnd(9)} 실행 digest 일치`);
    else fail(r.id, `실행 digest(${r.actual.length > 0 ? r.actual.join(', ') : '준비된 파드 없음'})가 매니페스트(${r.expected})와 다르다`, '실행 digest 불일치');
  }
  for (const ep of VERSION_ENDPOINTS) {
    if (manifest.images[ep.id] === undefined) continue;
    const problem = checkVersion(ep);
    if (problem === null) log(`  OK   ${ep.id.padEnd(9)} 앱 버전 ${manifest.images[ep.id].builtVersion}`);
    else fail(ep.id, problem);
  }
  return failures;
}

/** 반영 전 점검 — 클러스터에 미리 있어야 하는 Secret 이 있는지, 앱 Secret 이 인계됐는지(keep 주석 + Helm 소유 표시 없음) 본다. 읽기 전용(metadata 만). */
function assertClusterSecrets(tools) {
  for (const name of REQUIRED_SECRETS) {
    let metadata;
    try {
      metadata = tools.secretMetadata(name);
    } catch (err) {
      throw new Error(`Secret ${name} 을(를) 읽지 못했다 (없거나 권한이 없다) — deploy/helm/README.md 「클러스터에 미리 있어야 하는 Secret」 로 먼저 만든다\n${err.message}`);
    }
    if (name !== APP_SECRETS) continue;
    const annotations = isPlainObject(metadata?.annotations) ? metadata.annotations : {};
    // Helm 은 차트에서 빠진 리소스를 소유 주석과 무관하게 지운다 — keep 주석이 있어야 살아남는다. 소유 주석은 별개로 뗀다.
    if (annotations[HELM_KEEP_ANNOTATION] !== 'keep') {
      throw new Error(`Secret ${name} 에 ${HELM_KEEP_ANNOTATION}=keep 주석이 없다 — README 「Secret 인계」 1단계(keep 주석)를 먼저 실행한다 — 지금 업그레이드하면 Helm 이 이 Secret 을 지운다`);
    }
    if (HELM_OWNER_ANNOTATION in annotations) {
      throw new Error(`Secret ${name} 이(가) 아직 Helm 소유다(${HELM_OWNER_ANNOTATION} 주석) — README 「Secret 인계」 2단계(소유 표시 제거)를 먼저 실행한다`);
    }
  }
}

/**
 * 실패한 `helm upgrade` 뒤의 안내 문구. before·after 는 반영 전·지금의 리비전 모델(after 가 null 이면 history 를 다시 읽지 못했다).
 * 새 리비전이 없으면(템플릿 오류·다른 작업 진행 중·소유권 충돌 등) 클러스터가 그대로라 rollback 을 권하면 멀쩡한 릴리스를 한 단계 되돌리게 된다.
 * 새 리비전이 생겼어도 rollback 은 되돌아갈 정상 리비전이 있을 때(반영 전 deployed 가 있고 지금 롤백 계획이 선다)만 권한다.
 */
function upgradeFailureHint({ before, after, ctx }) {
  const status = `상태 확인: ${ctx.cmd('status')}  (helm history ${RELEASE_NAME} -n ${ctx.namespace} --kube-context ${ctx.context})`;
  if (after === null) {
    return `\nhelm upgrade 가 실패했고 helm history 를 다시 읽지 못했다 — 새 리비전이 생겼는지 알 수 없다. 자동 롤백은 하지 않았다. rollback 전에 먼저 ${status}`;
  }
  const latestAfter = after.latest?.revision ?? 0;
  if (latestAfter > (before.latest?.revision ?? 0)) {
    if (before.deployed !== null && rollbackPlan(after.items) !== null) {
      return `\nhelm upgrade 가 실패했다(새 리비전 ${latestAfter}). 자동 롤백은 하지 않았다. 직전 정상 리비전은 그대로 deployed 라 되돌리려면: ${ctx.cmd('rollback')}\n${status}`;
    }
    // 첫 설치 실패 등 — 새 리비전은 생겼지만 그 아래에 정상(deployed) 리비전이 없다. 되돌릴 곳이 없으니 rollback 을 권하지도, 이전 정상 리비전이 돈다고 말하지도 않는다.
    return `\nhelm upgrade 가 실패했다(새 리비전 ${latestAfter}). 정상 반영된(deployed) 리비전이 없어 되돌아갈 정상 리비전이 없다 — rollback 하지 않는다. 자동 롤백도 하지 않았다. 원인(위 helm 오류)을 고쳐 다시 반영(deploy)한다.\n${status}`;
  }
  const running = before.deployed === null ? '릴리스가 아직 설치되지 않았다' : `운영은 리비전 ${before.deployed.revision} 그대로다`;
  return `\nhelm upgrade 가 실패했다. 새 리비전이 만들어지지 않았다 — ${running}. rollback 하지 않는다. 원인은 위 helm 오류를 본다.\n${status}`;
}

/**
 * 「지금 운영 릴리스」를 정한다 → `{ before(반영 전 리비전 모델), current }`. 가장 높은 deployed 리비전 values 의 release.version, 전환 이전 리비전이면 --current 로 받는다.
 * (실패한 반영이 위에 얹혀 있어도 deployed 리비전을 읽으므로, 실패 뒤 같은 버전으로 다시 반영할 수 있다.)
 */
function resolveCurrent({ values, tools, log }) {
  const before = revisionModel(tools.history());
  const recorded = before.deployed === null ? null : tools.release(before.deployed.revision);
  if (recorded === null && !values.current) {
    throw new Error('지금 운영 릴리스를 알 수 없다 (release.version 이 기록되지 않은 전환 이전 리비전). --current <x.y.z> 로 현재 운영 버전을 알려 달라 (첫 전환은 --current 0.8.0)');
  }
  // --current 는 기록된 운영 릴리스가 없을 때만 쓴다 — 쓰지 않는데 형식을 따져 거부하지 않는다(무시한다고 경고만).
  if (recorded === null) assertVersion(values.current);
  else if (values.current && values.current !== recorded.version) log(`경고: --current(${values.current})를 무시하고 기록된 운영 릴리스 ${recorded.version} 를 쓴다`);
  return { before, current: recorded?.version ?? values.current };
}

/**
 * 배포 체크리스트(현재 → 대상)를 출력하고, ⚠ 항목이 있으면(--yes 가 아니면) 확인을 받는다 — 거부하면 throw. 매니페스트·체크리스트 파일은 work 에 쓴다.
 * 기준(현재 운영) 매니페스트는 「새 앱」 판정용 — 못 받으면(토큰 없음·패키지 404) 막지는 않되 새 앱 확인이 불가능하다는 사실을 ⚠ 로 취급해 확인을 받는다.
 */
async function confirmChecklist({ work, manifest, current, version, yes, ctx }) {
  const { repoRoot, exec, download, confirm, log, stdout, checklist } = ctx;
  const manifestFile = join(work, 'manifest.json');
  writeFileSync(manifestFile, JSON.stringify(manifest));
  const baseManifest = await tolerate(
    { when: true, log, what: `현재 릴리스 ${current} 의 매니페스트를 받지 못해 새 앱(시크릿·설정이 필요할 수 있다) 확인이 불가능하다` },
    async () => {
      const m = await readManifest({ version: current, download });
      if (m === null) throw new Error('패키지에 매니페스트가 없다 (404)');
      return m;
    },
    null,
  );
  const checklistArgs = ['--from', `v${current}`, '--to', `v${version}`, '--manifest', manifestFile, '--out', join(work, 'checklist.md')];
  if (baseManifest !== null) {
    const baseFile = join(work, 'base-manifest.json');
    writeFileSync(baseFile, JSON.stringify(baseManifest));
    checklistArgs.push('--base-manifest', baseFile);
  }
  const { sections } = await checklist(checklistArgs, { repoRoot, exec, download, log, stdout });
  const newAppsUnknown = baseManifest === null || !Array.isArray(sections.newApps);
  if (yes || !hasWarnings(sections, { newAppsUnknown })) return;
  const why = newAppsUnknown ? '체크리스트에 확인할 항목(⚠)이 있거나 새 앱 확인이 불가능하다' : '위 체크리스트에 확인할 항목(⚠)이 있다';
  if (!(await confirm(`${why}. ${current} → ${version} 반영을 계속할까?`))) throw new Error('사용자가 반영을 중단했다');
}

/** 차트는 작업 트리가 아니라 릴리스 태그 지점에서 꺼낸다(git archive → tar). 꺼낸 차트 디렉터리를 돌려준다. */
function extractChart({ work, version, ctx }) {
  const tarFile = join(work, 'chart.tar');
  const chartRoot = join(work, 'chart');
  mkdirSync(chartRoot);
  ctx.exec('git', ['archive', '--format=tar', '-o', tarFile, `v${version}`, 'deploy/helm'], { cwd: ctx.repoRoot });
  ctx.exec('tar', ['-xf', tarFile, '-C', chartRoot]);
  return join(chartRoot, 'deploy', 'helm');
}

/**
 * deploy 본체: 운영 릴리스 판정 → 매니페스트·태그 검증 → 차트 존재·Secret 점검 → (임시 디렉터리에서) 체크리스트 확인 → 차트 추출 → helm upgrade → 반영 확인.
 * 임시 디렉터리(차트·values·체크리스트)는 끝에 지운다.
 */
async function deploy({ positionals, values, ctx }) {
  const { log, tmpdir, tools, context, namespace, cmd } = ctx;
  const version = positionals[0];
  if (!version) throw new Error(`반영할 버전이 필요하다: ${SELF} deploy <x.y.z>`);
  assertVersion(version);

  const { before, current } = resolveCurrent({ values, tools, log });
  if (current === version && !values.force) throw new Error(`릴리스 ${version} 은(는) 이미 반영되어 있다 (같은 버전을 다시 반영하려면 --force)`);
  const manifest = await loadTargetManifest({ version, file: values.manifest, ctx });
  assertChartAtTag({ version, ctx });
  // 클러스터 사전 점검(읽기 전용): 필수 Secret 존재·인계 여부. 확인 질문·upgrade 보다 먼저, 매 실행.
  assertClusterSecrets(tools);

  return withTempDir(tmpdir, 'release-deploy-', async (work) => {
    await confirmChecklist({ work, manifest, current, version, yes: values.yes, ctx });
    const chartDir = extractChart({ work, version, ctx });
    const imagesFile = join(work, 'images.json');
    writeFileSync(imagesFile, JSON.stringify(imageValues(manifest)));

    log(`\n반영: ${current} → ${version} (context ${context}, namespace ${namespace})`);
    try {
      // --atomic 금지: 실패 시 자동 롤백이 Flyway 마이그레이션 뒤의 스키마와 어긋날 수 있다.
      tools.helmLive(['upgrade', '--install', RELEASE_NAME, chartDir, '-f', join(chartDir, 'values.prod.yaml'), '-f', imagesFile, '--wait', '--timeout', HELM_TIMEOUT, '--description', `release ${version} (${manifest.commit.slice(0, 12)})`]);
    } catch (err) {
      // 실패한 upgrade 가 새 리비전을 남겼는지 history 를 다시 읽어 가른다(안 남겼다면 rollback 을 권하지 않는다).
      let after = null;
      try {
        after = revisionModel(tools.history());
      } catch {
        // 못 읽으면 안내가 그 사실을 알린다(after = null).
      }
      log(upgradeFailureHint({ before, after, ctx }));
      throw err;
    }

    log('\n반영 확인');
    let failures;
    try {
      failures = verifyDeployment({ manifest, tools, log });
    } catch (err) {
      // 확인 자체가 죽은 경우(kubectl·프록시 오류) — 업그레이드는 이미 끝났다는 사실을 잃지 않게 감싼다.
      let revision = '리비전 확인 불가';
      try {
        revision = `리비전 ${revisionModel(tools.history()).latest?.revision}`;
      } catch {
        // history 를 못 읽어도 원래 오류를 전하는 게 우선이다.
      }
      throw new Error(`업그레이드는 끝났다(${revision}) — 반영 확인 중 오류: ${err.message}\n자동 롤백은 하지 않았다. 상태 확인: ${cmd('status')}`);
    }
    if (failures.length > 0) {
      throw new Error(`반영 확인 실패 (${failures.length}건):\n  - ${failures.join('\n  - ')}\n자동 롤백은 하지 않았다. 판단 뒤 되돌리려면: ${cmd('rollback')}`);
    }
    log(`\n릴리스 ${version} 반영 완료`);
    return { version, previous: current };
  });
}

/**
 * 롤백이 걸친 마이그레이션 구간 `{ from, to, forward, newer?, note? }` — from = 옛 릴리스, to = 새 릴리스(모르면 null). releaseOf 는 리비전 항목 → 릴리스.
 *  - recover·fallback: 실패한 시도가 이미 마이그레이션을 돌렸을 수 있어 「대상 → 실패한 시도(latest)」로 본다.
 *  - toggle: 기본은 「대상(옛) → 지금 운영(새)」. 대상이 지금보다 새 릴리스면(되돌리기를 되돌림) 방향이 거꾸로라 「지금 → 대상」 순방향으로 보고 ⚠ 문구(newer)를,
 *    같은 릴리스면 참고 문구(note)를 함께 돌려준다.
 */
function rollbackRange(plan, releaseOf) {
  const target = releaseOf(plan.target);
  const latest = releaseOf(plan.latest);
  switch (plan.kind) {
    case 'recover':
    case 'fallback':
      return { from: target, to: latest, forward: false };
    case 'toggle': {
      // toggle 이면 latest = deployed(지금 운영).
      if (target === null || latest === null || !parseVersion(target.version) || !parseVersion(latest.version)) return { from: target, to: latest, forward: false };
      const cmp = compareVersions(target.version, latest.version);
      if (cmp > 0) {
        return { from: latest, to: target, forward: true, newer: `대상 리비전 ${plan.target.revision} 은 지금(${latest.version})보다 새 릴리스 ${target.version} 다 — 되돌리기를 되돌리는 것이다` };
      }
      const note = cmp === 0 ? `참고: 대상 리비전 ${plan.target.revision} 은 지금과 같은 릴리스 ${target.version} 다 — 같은 릴리스 재적용` : undefined;
      return { from: target, to: latest, forward: false, note };
    }
    default:
      throw new Error(`알 수 없는 롤백 계획: ${plan.kind}`);
  }
}

/**
 * rollback 본체. 마지막 정상 리비전(rollbackPlan)과 현재를 출력하고, 위험(전환 이전·마이그레이션)을 경고한 뒤 확인을 받아 `helm rollback` 한다.
 * 실패한 반영이 위에 얹혀 있으면 그 시도가 이미 마이그레이션을 돌렸을 수 있어, 마이그레이션 범위는 「대상 → 실패한 시도(latest)」로 본다(rollbackRange).
 */
async function rollback({ values, ctx }) {
  const { confirm, log, tools, cmd } = ctx;
  const history = tools.history();
  if (history.length === 0) throw new Error('릴리스가 없다 (helm history: release not found) — 되돌릴 리비전이 없다');
  const plan = rollbackPlan(history);
  if (plan === null) throw new Error('되돌아갈 리비전이 없다 (마지막 정상 리비전으로 복구할 수도, 앞선 superseded 리비전으로 갈 수도 없다)');
  const { target, deployed, attempt } = plan;
  // 같은 리비전의 values 를 두 번 읽지 않는다(대상·지금·시도는 서로 같은 리비전일 수 있다).
  const releases = new Map();
  const releaseOf = (item) => {
    if (!releases.has(item.revision)) releases.set(item.revision, tools.release(item.revision));
    return releases.get(item.revision);
  };
  const targetRelease = releaseOf(target);

  log(deployed === null ? '현재: 정상 배포된(deployed) 리비전이 없다' : `현재: 리비전 ${deployed.revision} (${describeRelease(releaseOf(deployed))})`);
  if (attempt !== null) log(`실패한 반영: 리비전 ${attempt.revision} (${attempt.status}, ${describeRelease(releaseOf(attempt))})`);
  log(`되돌릴 대상: 리비전 ${target.revision} (${describeRelease(targetRelease)})`);

  const warnings = [];
  if (attempt !== null && String(attempt.status).startsWith('pending')) {
    warnings.push(`리비전 ${attempt.revision} 가 ${attempt.status} 상태다 — 진행 중인 helm 작업이 있으면 helm 이 롤백을 거부할 수 있다. 그래도 helm 에 넘긴다.`);
  }
  if (targetRelease === null) {
    if (!values.force) {
      throw new Error(`리비전 ${target.revision} 은(는) 전환 이전 리비전이다 (release.version 없음). 그 리비전은 Secret 을 차트 값으로 들고 있고 이미지도 :latest 라 되돌리지 않는다 (deploy/helm/README.md). 그래도 하려면 --force`);
    }
    warnings.push('전환 이전 리비전으로 되돌린다(--force): 옛 Secret 값이 클러스터를 덮거나 :latest 이미지가 다시 받아질 수 있다.');
  }
  const range = rollbackRange(plan, releaseOf);
  if (range.newer) warnings.push(range.newer);
  if (range.note) log(range.note);
  warnings.push(...(await migrationWarnings({ from: range.from, to: range.to, forward: range.forward, ctx })));
  for (const w of warnings) log(`⚠ ${w}`);

  const confirmPrefix = range.newer ? `⚠ ${range.newer}\n` : '';
  if (!values.yes && !(await confirm(`${confirmPrefix}리비전 ${target.revision} 로 롤백할까?`))) throw new Error('사용자가 롤백을 중단했다');
  tools.helmLive(['rollback', RELEASE_NAME, String(target.revision), '--wait', '--timeout', HELM_TIMEOUT]);
  log(`\n리비전 ${target.revision} 로 롤백했다. 확인: ${cmd('status')}`);
  return { target: target.revision };
}

/**
 * 롤백이 걸친 구간(from = 옛 릴리스, to = 새 릴리스)의 마이그레이션 경고 문구 목록. 두 릴리스를 다 알면 체크리스트로 추가·수정을 찾고,
 * 모르거나 체크리스트를 못 만들면(태그 없음 등) 막지 않고 일반 경고를 낸다.
 */
async function migrationWarnings({ from, to, forward, ctx }) {
  const { repoRoot, exec, log, tmpdir, checklist } = ctx;
  const generic = `대상·현재 릴리스 사이의 마이그레이션을 확인하지 못했다. ${SCHEMA_WARNING}`;
  if (from === null || to === null) return [generic];
  return withTempDir(tmpdir, 'release-rollback-', async (work) => {
    try {
      const { sections } = await checklist(['--from', `v${from.version}`, '--to', `v${to.version}`, '--out', join(work, 'checklist.md')], {
        repoRoot,
        exec,
        download: async () => null,
        log,
        stdout: () => {},
      });
      // added 는 `{ file, version, summary }`, changed 는 파일명 문자열이다.
      const files = [...sections.migrations.added.map((m) => m.file), ...sections.migrations.changed];
      const direction = forward ? '(대상이 더 새 릴리스라 순방향 구간)' : '';
      return files.length > 0 ? [`${from.version} → ${to.version} 사이에 DB 마이그레이션이 있다${direction} (${files.join(', ')}). ${SCHEMA_WARNING}`] : [];
    } catch (err) {
      log(`경고: 마이그레이션 확인에 실패했다 (${err.message})`);
      return [generic];
    }
  });
}

/**
 * status 본체. 운영 중인(deployed) 리비전을 기준으로 보이고, 그 위에 실패·진행 중 시도가 있으면 ⚠ 로 알린다.
 * 매니페스트(release.version 으로 받음)가 있으면 digest 일치까지, 없으면 실행 중인 digest 만 표시한다.
 */
async function status({ values, ctx }) {
  const { repoRoot, download, log, stdout, tools } = ctx;
  const model = revisionModel(tools.history());
  if (model.items.length === 0) throw new Error('릴리스가 없다 (helm history: release not found)');
  // deployed 가 없으면(첫 설치 실패 등) 마지막 리비전을 그대로 보인다 — 그때는 보이는 리비전이 곧 시도라 「위에 얹힌 시도」 줄을 따로 내지 않는다.
  const shown = model.deployed ?? model.latest;
  const release = tools.release(shown.revision);
  const attempt = model.deployed === null || model.attempt === null ? null : { revision: model.attempt.revision, status: model.attempt.status, release: tools.release(model.attempt.revision) };
  const warnings = [];
  if (model.deployed === null) warnings.push('정상 반영된 리비전이 없다 — 아래는 마지막 리비전이다');
  let manifest = null;
  if (values.manifest) {
    manifest = await readManifest({ file: values.manifest });
    if (!isPlainObject(manifest) || !isPlainObject(manifest.images)) throw new Error('--manifest 파일에 images 가 없다 — 릴리스 매니페스트(build-images 산출물)가 맞는지 확인한다');
    // 낡은 파일이면 「매니페스트 digest ↔ 실행 digest」 열이 엉뚱한 기준으로 계산된다 — 그대로 그리되 경고한다.
    if (release !== null && manifest.version !== release.version) warnings.push(`--manifest 의 버전(${manifest.version})이 운영 릴리스(${release.version})와 다르다 — 일치 열은 이 파일 기준이다`);
  } else if (release !== null) {
    manifest = await tolerate({ when: true, log, what: `릴리스 ${release.version} 의 매니페스트를 받지 못해 실행 중인 digest 만 보인다` }, async () => {
      const m = await readManifest({ version: release.version, download });
      if (m === null) log(`매니페스트 ${release.version} 없음 — digest 일치는 판정하지 않음`);
      else if (!isPlainObject(m.images)) throw new Error('받은 매니페스트에 images 가 없다');
      return m;
    }, null);
  }

  const ids = manifest !== null ? Object.keys(manifest.images) : loadCatalog(repoRoot).images.map((i) => i.id);
  const podsByApp = tools.podsByApp();
  const matches = manifest === null ? null : new Map(checkDigests({ manifest, podsByApp }).map((r) => [r.id, r.ok]));
  const rows = ids.map((id) => ({
    id,
    builtVersion: manifest?.images[id]?.builtVersion ?? null,
    // 매니페스트 digest 가 없으면 실행 중인 digest(정렬 첫 값)를 보인다.
    digest: manifest?.images[id]?.digest ?? runningDigests(podsByApp, id)[0] ?? null,
    match: matches?.get(id) ?? null,
  }));
  stdout(renderStatus({ revision: shown, release, attempt, warnings, rows }));
  return { revision: shown, release, rows };
}


/**
 * CLI 본체. 외부 의존(exec·다운로드·확인 질문·로그·stdout·임시 디렉터리·체크리스트)을 주입받아 테스트가 helm·kubectl·git·네트워크 없이 흐름을 검증한다.
 * 실패·거부는 throw 한다(진입점이 `오류: …` 를 찍고 종료 코드 1 로 끝낸다).
 */
export async function main(argv, { repoRoot = REPO_ROOT, exec = defaultExec, download = downloadManifest, confirm = ttyConfirm, log = console.error, stdout = (s) => process.stdout.write(s), tmpdir = osTmpdir(), checklist = checklistMain } = {}) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      manifest: { type: 'string' },
      current: { type: 'string' },
      yes: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      context: { type: 'string', default: DEFAULT_CONTEXT },
      namespace: { type: 'string', default: DEFAULT_NAMESPACE },
    },
    strict: true,
  });
  const [command, ...rest] = positionals;
  // 위치 인자 개수를 엄격히 — `rollback 14` 처럼 입력한 것과 다른 동작이 실행되지 않게 helm·kubectl 호출 전에 거부한다.
  const allowed = { deploy: 1, rollback: 0, status: 0 }[command];
  if (allowed !== undefined && rest.length > allowed) {
    throw new Error(allowed === 0 ? `${command} 는 위치 인자를 받지 않는다 (받은 인자: ${rest.join(' ')}). ${command === 'rollback' ? '마지막 정상 리비전으로만 되돌린다 — 리비전은 고를 수 없다' : '옵션만 쓴다'}` : `${command} 는 버전 하나만 받는다: ${SELF} deploy <x.y.z> (받은 인자: ${rest.join(' ')})`);
  }
  const context = values.context;
  const namespace = values.namespace;
  const tools = makeClusterTools({ exec, context, namespace });
  /** 안내 문구에 넣을 이 도구의 명령 — 같은 클러스터를 가리키도록 --context·--namespace 를 항상 붙인다. */
  const cmd = (name) => `${SELF} ${name} --context ${context} --namespace ${namespace}`;
  const ctx = { repoRoot, exec, download, confirm, log, stdout, tmpdir, tools, checklist, context, namespace, cmd };
  switch (command) {
    case 'deploy':
      return deploy({ positionals: rest, values, ctx });
    case 'rollback':
      return rollback({ values, ctx });
    case 'status':
      return status({ values, ctx });
    default:
      throw new Error(`사용법: ${SELF} deploy <x.y.z> | rollback | status  [--context <ctx>] [--namespace <ns>]`);
  }
}

// 테스트가 main 만 import 할 때는 실행하지 않는다.
if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`오류: ${err.message}`);
    process.exit(1);
  });
}
