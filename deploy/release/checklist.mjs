#!/usr/bin/env node
// 배포 체크리스트 CLI (WP-441).
//   node deploy/release/checklist.mjs --from <git ref> [--to <git ref, 기본 HEAD>] [--base-manifest <file> | --base-version <x.y.z>] [--manifest <file>] [--out <file>]
// 두 git 지점 사이에서 「배포 전에 사람이 확인할 것」(새 앱·Helm 에 없는 새 환경변수·DB 마이그레이션·Helm 차트 변경·이미지·포함 이슈)을 모아
// 마크다운으로 만든다. 결과는 --out(기본 <저장소 루트>/release-checklist.md)에 쓰고 같은 내용을 stdout 으로도 낸다(CI 가 잡아 쓰도록).
// 진행 로그·경고는 stderr(log)로만 낸다 — stdout 은 마크다운 전용으로 둬야 그대로 파이프할 수 있다.
//   --base-manifest  기준(운영) 릴리스의 매니페스트 파일.  --base-version  GitLab 패키지에서 받는다.  둘 다 없으면 새 앱 판정을 생략한다.
//   --manifest       이번 릴리스 매니페스트(build-images 의 결과). 있으면 이미지 표를 싣는다.
// --base-version 에 필요한 환경변수: CI_API_V4_URL · CI_PROJECT_ID · 그리고 CI_JOB_TOKEN 또는 GITLAB_TOKEN (lib/manifest-store.mjs 가 읽는다).
// 종료 코드: 0 = 체크리스트를 만들었다(경고가 있어도), 1 = 실패(인자 오류·얕은 clone·git/다운로드 실패 등; 사유는 stderr `오류: …`).
// 얕은 clone 에서는 비교 범위·이력을 믿을 수 없어 멈춘다 — CI 는 `GIT_DEPTH: 0`.
// Helm 템플릿·values.yaml·이미지 카탈로그·Dockerfile 은 작업 트리가 아니라 --to 지점에서 읽는다(체크 대상 커밋과 다른 파일을 보지 않게). 카탈로그가 --to 에 없으면 새 앱 판정을 생략하고 그 사실을 적는다.
// 프로그램에서 쓸 때는 main() 이 `{ markdown, out, sections }` 를 돌려준다(sections: 마크다운이 되기 전의 계산 결과).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assertNotShallow, defaultExec, nulSplit } from './lib/build.mjs';
import { isPlainObject, validateCatalog } from './lib/catalog.mjs';
import { changedMigrationFiles, dockerEnvNames, extractEnvVars, filterAlreadySet, helmNames, newApps, parseExistingSecretKeys, parseMigrations, pickIssues, renderChecklist } from './lib/checklist.mjs';
import { defaultOutPath, isMainModule } from './lib/cli.mjs';
import { downloadManifest } from './lib/manifest-store.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MIGRATION_DIR = 'apps/workplace-api/src/main/resources/db/migration';
const HELM_DIR = 'deploy/helm/';
const TEMPLATE_DIR = 'deploy/helm/templates/';
const VALUES_FILE = 'deploy/helm/values.yaml';
const CATALOG_FILE = 'deploy/release/image-catalog.json';

const OUT_FILE = 'release-checklist.md';
const NO_HELM_NOTE = '이 지점에는 deploy/helm 차트가 없어 Helm 비교를 하지 않았다';
const NO_CATALOG_NOTE = `이 지점에는 ${CATALOG_FILE} 이 없어 새 앱을 판정하지 않았다`;

/** 기준 매니페스트를 구한다(없으면 null → 새 앱 판정 생략). 파일이든 패키지든 images 객체가 있어야 판정에 쓸 수 있어 모양만 확인한다. */
async function loadBaseManifest({ baseFile, baseVersion, download }) {
  if (baseFile && baseVersion) throw new Error('--base-manifest 와 --base-version 은 함께 쓸 수 없다');
  let manifest = null;
  if (baseFile) manifest = JSON.parse(readFileSync(baseFile, 'utf8'));
  else if (baseVersion) {
    manifest = await download(baseVersion);
    if (manifest === null) throw new Error(`기준 릴리스 ${baseVersion} 의 매니페스트를 찾지 못했다`);
  }
  if (manifest !== null && !isPlainObject(manifest.images)) throw new Error('기준 매니페스트에 images 가 없다');
  return manifest;
}

/** `--to` 지점의 카탈로그 본문을 파싱·검증한다 — 깨졌으면 어느 지점의 파일인지 담아 throw. */
function parseCatalogAt(text, to) {
  try {
    return validateCatalog(JSON.parse(text));
  } catch (err) {
    throw new Error(`${to} 지점의 ${CATALOG_FILE} 이 올바르지 않다: ${err.message}`);
  }
}

/** git 옵션으로 해석되는 값(`-` 시작)을 ref 로 받지 않는다 — `--from=--output=x` 같은 값이 git 인자로 새는 것을 막는다. */
function assertRef(flag, value) {
  if (value.startsWith('-')) throw new Error(`${flag} 값은 '-' 로 시작할 수 없다 (git 옵션으로 해석될 수 있다): ${value}`);
}

/**
 * CLI 본체. git·다운로드·로그·stdout 을 주입받아 테스트·호출자(WP-443 등)가 실제 git·네트워크·출력 없이 흐름을 검증한다. 실패하면 throw(진입점이 종료 코드 1).
 * 반환: `{ markdown, out, sections }` — sections 는 `{ newApps, envVars, migrations: { added, changed }, helmChanges, issues, envNote, appsNote }`.
 */
export async function main(argv, { repoRoot = REPO_ROOT, exec = defaultExec, download = downloadManifest, log = console.error, stdout = (s) => process.stdout.write(s) } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      from: { type: 'string' },
      to: { type: 'string', default: 'HEAD' },
      'base-manifest': { type: 'string' },
      'base-version': { type: 'string' },
      manifest: { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
  });
  const { from, to } = values;
  if (!from) throw new Error('--from <git ref> 가 필요하다');
  assertRef('--from', from);
  assertRef('--to', to);
  const git = (...args) => exec('git', args, { cwd: repoRoot }).stdout;
  // 얕은 clone 은 from..to 이력(포함 이슈)과 조상 관계를 믿을 수 없다 — 빈/틀린 체크리스트를 내느니 멈춘다(findBase 와 같은 이유).
  assertNotShallow(exec, repoRoot, '비교 범위');
  // -U0 내용 diff 는 사용자·시스템 git 설정(색·외부 diff 도구·접두·경로 이스케이프)에 출력 모양(`+++ b/…`)이 흔들리지 않게 고정한다.
  const contentDiff = (...args) => git('-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', ...args);
  /** `from`↔`to` 사이 바뀐 파일 경로 목록(NUL 구분이라 이스케이프 설정과 무관). */
  const changedPaths = (flags, pathspec) => nulSplit(git('diff', ...flags, '--name-only', '-z', from, to, '--', pathspec));
  /** `--to` 지점의 파일 내용. */
  const catAt = (path) => git('show', `${to}:${path}`);
  /** `--to` 지점에 없는 파일은 null — 존재 여부를 따로 묻지 않고 `git show` 의 실패로 판단한다(잘못된 ref 는 앞선 ls-tree·diff 에서 이미 실패한다). */
  const showAt = (path) => {
    try {
      return catAt(path);
    } catch {
      return null;
    }
  };

  const baseManifest = await loadBaseManifest({ baseFile: values['base-manifest'], baseVersion: values['base-version'], download });
  // 기준 매니페스트가 가리키는 커밋과 --from 이 다르면 「새 앱」 판정과 diff 범위가 서로 다른 기준을 본다 — 막지는 않고 알린다.
  if (baseManifest !== null && typeof baseManifest.commit === 'string') {
    const fromCommit = git('rev-parse', `${from}^{commit}`).trim();
    if (fromCommit !== baseManifest.commit) log(`경고: 기준 매니페스트의 커밋(${baseManifest.commit})이 --from(${from} = ${fromCommit})과 다르다`);
  }
  const manifest = values.manifest ? JSON.parse(readFileSync(values.manifest, 'utf8')) : null;

  // 템플릿은 줄바꿈으로 이어 앞 파일의 끝과 뒤 파일의 처음이 붙어 없는 변수명이 생기지 않게 한다. 하나도 없으면 차트 없음.
  const templatePaths = nulSplit(git('ls-tree', '-r', '--name-only', '-z', to, '--', TEMPLATE_DIR));
  const helmText = templatePaths.map(catAt).join('\n');
  // 「이미 설정됨」 = Helm 템플릿에 나오는 이름 ∪ 이미지 Dockerfile 의 ENV(TMPDIR·HOME 등) ∪ values.yaml 의 existingSecretKeys(envFrom 주입이라 템플릿에 이름이 없다).
  // ls-tree 는 글롭을 못 쓰니 apps/ 를 나열해 `apps/<앱>/Dockerfile*` 만 고른다.
  const dockerfilePaths = nulSplit(git('ls-tree', '-r', '--name-only', '-z', to, '--', 'apps/')).filter((p) => /^apps\/[^/]+\/Dockerfile[^/]*$/.test(p));
  const valuesText = showAt(VALUES_FILE);
  const alreadySet = new Set([
    ...helmNames(helmText),
    ...dockerfilePaths.flatMap((p) => [...dockerEnvNames(catAt(p))]),
    ...(valuesText === null ? [] : parseExistingSecretKeys(valuesText)),
  ]);

  // 파일 비교는 두 점(트리 비교)이라 from 이 to 의 조상이 아니어도(핫픽스 대비 운영 릴리스가 더 높은 경우 등) 되고, 이슈는 from..to 그대로.
  // 환경변수는 앱 코드·설정에서만 뽑으므로 pathspec `apps/` 로 문서·락 파일 등의 큰 diff 를 받지 않는다.
  const envVars = filterAlreadySet(extractEnvVars(contentDiff('-U0', '--no-renames', from, to, '--', 'apps/')), alreadySet);
  // --no-renames: 이름을 바꾼 마이그레이션이 R 로 묶여 A/D 어디에도 안 잡히는 것을 막는다(옛 이름은 삭제, 새 이름은 추가로 본다).
  const added = changedPaths(['--no-renames', '--diff-filter=A'], MIGRATION_DIR);
  const migrations = {
    added: parseMigrations(added.map((path) => ({ path, firstLine: catAt(path).split('\n')[0] }))),
    changed: changedMigrationFiles(changedPaths(['--no-renames', '--diff-filter=MD'], MIGRATION_DIR)),
  };
  const helmChanges = changedPaths([], HELM_DIR);
  const issues = pickIssues(git('log', '--format=%s', `${from}..${to}`).split('\n').filter((s) => s !== ''));
  // 카탈로그는 새 앱 판정에만 쓰므로 기준 매니페스트가 없으면 읽지 않는다(그 지점 카탈로그의 문제가 상관없는 체크리스트를 막지 않게). 카탈로그 자체가 없으면(이미지 체계 이전 커밋) 판정 불가(null)와 그 이유.
  let apps = null;
  let appsNote = null;
  if (baseManifest !== null) {
    const catalogText = showAt(CATALOG_FILE);
    if (catalogText === null) appsNote = NO_CATALOG_NOTE;
    else apps = newApps({ catalog: parseCatalogAt(catalogText, to), baseManifest, helmText });
  }
  const envNote = templatePaths.length === 0 ? NO_HELM_NOTE : null;

  const markdown = renderChecklist({ from, to, newApps: apps, envVars, migrations, helmChanges, manifest, issues, envNote, appsNote });
  const out = values.out ?? defaultOutPath(repoRoot, OUT_FILE);
  writeFileSync(out, markdown);
  log(`배포 체크리스트 ${from} → ${to} → ${out}`);
  stdout(markdown);
  return { markdown, out, sections: { newApps: apps, envVars, migrations, helmChanges, issues, envNote, appsNote } };
}

// 테스트가 main 만 import 할 때는 실행하지 않는다.
if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`오류: ${err.message}`);
    process.exit(1);
  });
}
