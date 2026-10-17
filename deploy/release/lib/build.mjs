// 릴리스 이미지 빌드·태그·매니페스트 오케스트레이션 (WP-440).
// 흐름: 사전 검사 → 변경 감지(selectImages) → 변경된 앱만 빌드(+push) → 전부 성공한 뒤에만 `:<버전>` 태그 → 태그 digest 검증 → 매니페스트.
// 외부 명령(git·docker)은 전부 주입된 `exec(cmd, args, opts?)`(동기, 실패 시 throw, `{ stdout }` 반환)로만 부른다 — 테스트가 실제 git·docker 없이 검증한다.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPlainObject, loadCatalog, workspaceDeps } from './catalog.mjs';
import { isoSeconds } from './cli.mjs';
import { findBaseTag, isVersionTag, parseVersion } from './semver.mjs';
import { selectImages } from './select.mjs';

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
/** dry-run 이 build 결과로 내는 가짜 digest — 실제 이미지가 없다는 게 한눈에 보이게 전부 0. */
const DRY_RUN_DIGEST = `sha256:${'0'.repeat(64)}`;

/**
 * 실제 실행기. 기본은 stdout 을 잡아 돌려주고, `{ capture: false }` 면 자식의 출력을 그대로 흘린다(긴 docker 빌드 로그를 실시간으로 보려고).
 * 종료 코드가 0 이 아니면 명령과 stderr 를 담아 throw 한다.
 */
export function defaultExec(cmd, args, { capture = true, cwd } = {}) {
  // maxBuffer: 기본 1MB 면 릴리스 범위 전체 `git diff -U0`(WP-441, 수백 KB~수 MB)가 ENOBUFS 로 잘린다. 넉넉히 256MB.
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  if (r.error) throw new Error(`${cmd} 실행 실패: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 실패 (종료 코드 ${r.status})${r.stderr ? `\n${r.stderr.trim()}` : ''}`);
  return { stdout: r.stdout ?? '' };
}

/** 레지스트리에서 `ref` 의 매니페스트 digest 를 읽는다(`docker buildx imagetools inspect`). */
export function inspectDigest(exec, ref, opts) {
  const out = exec('docker', ['buildx', 'imagetools', 'inspect', ref, '--format', '{{json .Manifest}}'], opts).stdout;
  return JSON.parse(out).digest;
}

/** 한 줄에 한 항목인 출력(git tag)을 배열로. */
const lines = (stdout) => stdout.split('\n').map((l) => l.trim()).filter(Boolean);

/** NUL 로 구분된 출력(`git diff -z`)을 배열로 — 빈 항목(끝의 NUL)은 버린다. 경로를 trim 하지 않는다(공백으로 끝나는 파일명도 있을 수 있다). */
export const nulSplit = (stdout) => stdout.split('\0').filter((s) => s !== '');

/**
 * `docker buildx imagetools create` 인자(빌드 앱 태그·승계 태그·시드 공용).
 * `--prefer-index=false`: 기본값은 단일 매니페스트를 index 로 감싸 새 digest 가 되어, 「기준 digest 승계」 검증과 운영 바이트 동일성이 깨진다.
 */
export function imagetoolsCreateArgs(target, source) {
  return ['buildx', 'imagetools', 'create', '--prefer-index=false', '-t', target, source];
}

/** 릴리스 버전은 `x.y.z`(v 접두 없음)만 허용 — 이미지 태그·APP_VERSION 이 잘못 나가기 전에 막는다. */
export function assertVersion(version) {
  if (parseVersion(version) === null) throw new Error(`잘못된 버전: ${JSON.stringify(version)} (x.y.z 형식, v 접두 없음)`);
}

/**
 * 얕은 clone 이면 throw — 조상 태그·커밋 이력을 믿을 수 없어 「기준 없음」이나 빈 비교 범위로 오인하게 된다(findBase·체크리스트 CLI 공용).
 * `what` 은 오류 문구에 들어갈 「판정하지 못하는 것」(예: '기준 태그', '비교 범위').
 */
export function assertNotShallow(exec, repoRoot, what) {
  if (exec('git', ['rev-parse', '--is-shallow-repository'], { cwd: repoRoot }).stdout.trim() === 'true') {
    throw new Error(`얕은 clone 에서는 ${what}를 판정할 수 없다. 전체 이력을 받아라 (CI: GIT_DEPTH: 0, 로컬: git fetch --unshallow --tags)`);
  }
}

/**
 * 변경 비교의 기준 릴리스 → `{ baseTag: 'v0.8.0'|null, baseVersion: '0.8.0'|null }`. 기준 = HEAD 조상 태그 중 자기 자신(`v<version>`)을 뺀 최고 semver.
 * 「기준 없음」으로 오인하면 전부 재빌드되므로 두 경우는 실패시킨다: 얕은 clone(조상 태그를 못 봄), 조상에 기준이 없는데 저장소에 `vX.Y.Z` 태그가 있음(태그 미수신).
 * 후자는 자기 태그도 세므로 첫 릴리스는 늘 allowNoBase 가 필요하고, 시드된 기준 릴리스의 태그를 다시 push 해도 덮어쓰지 못하고 멈춘다(의도).
 */
export function findBase({ exec, repoRoot, version, allowNoBase = false }) {
  assertVersion(version);
  const git = (...args) => exec('git', args, { cwd: repoRoot }).stdout;
  assertNotShallow(exec, repoRoot, '기준 태그');
  const baseTag = findBaseTag(lines(git('tag', '--merged', 'HEAD', '--list', 'v*')), `v${version}`);
  if (baseTag === null && !allowNoBase && lines(git('tag', '--list', 'v*')).filter(isVersionTag).length > 0) {
    throw new Error('HEAD 의 조상에 기준 릴리스 태그가 없는데 저장소에는 v* 태그가 있다(자기 태그 포함). 태그를 받지 못했을 수 있다 (CI: GIT_DEPTH: 0 과 태그 fetch 확인). 의도한 것(첫 릴리스)이면 --allow-no-base');
  }
  return { baseTag, baseVersion: baseTag === null ? null : baseTag.slice(1) };
}

/** 이미 게시된 릴리스를 다시 돌릴 때의 안내 문구 — 빌드와 시드는 `:<버전>` 태그가 옮겨 가는 이유가 달라 문구를 따로 둔다. */
const PUBLISHED_WORDING = {
  빌드: {
    force: (v) => `--force 로 다시 빌드한다 (빌드 앱의 digest 와 :${v} 태그가 바뀐다)`,
    stop: (v) => `다시 빌드하면 :${v} 태그가 다른 이미지로 옮겨 간다. 의도한 것이면 --force`,
  },
  시드: {
    force: (v) => `--force 로 다시 시드한다 (:${v} 태그가 원본 digest 로 옮겨진다)`,
    stop: (v) => `다시 시드하면 :${v} 태그가 다른 이미지로 옮겨 갈 수 있다. 의도한 것이면 --force`,
  },
};

/**
 * 이미 게시된 릴리스를 덮어쓰지 않게 막는다 — `existing`(그 버전의 게시 매니페스트, 없으면 null)나 `taggedIds`(레지스트리에 `:<버전>` 태그가 남은 앱)가 있으면
 * --force 없이는 throw, --force 면 경고만, dry-run 은 아무것도 바꾸지 않으므로 경고만. `action` 은 문구 선택('빌드'|'시드').
 * 태그만 남은 경우는 태그 부여 뒤 업로드 전에 멈춘 실행이다(매니페스트는 업로드 단계에서야 생긴다).
 */
export function checkAlreadyPublished({ existing, taggedIds = [], version, force = false, dryRun = false, action = '빌드', warn = console.error }) {
  let what;
  if (existing !== null && existing !== undefined) what = `릴리스 ${version} 의 매니페스트가 이미 게시돼 있다`;
  else if (taggedIds.length > 0) what = `:${version} 태그가 이미 있는 앱이 있다(${taggedIds.join(', ')}) — 이전 실행이 태그 뒤 업로드 전에 멈췄을 수 있다`;
  else return;
  const wording = PUBLISHED_WORDING[action];
  if (dryRun) {
    warn(`경고: ${what}. 실제 실행이면 --force 없이는 중단된다`);
  } else if (force) {
    warn(`경고: ${what}. ${wording.force(version)}`);
  } else {
    throw new Error(`${what}. ${wording.stop(version)}`);
  }
}

/**
 * 레지스트리에 `<저장소>:<버전>` 태그가 이미 있는 앱 id 목록. inspect 가 `not found`(태그 없음)·`does not exist`(첫 push 전 저장소, 예: converter)로 실패하면 「없음」.
 * 그 밖의 실패(인증·네트워크)는 판단할 수 없으니 던진다 — 모르는 채로 덮어쓰지 않게.
 */
export function findVersionTags({ exec, repoRoot, catalog, version }) {
  const found = [];
  for (const { id, repository } of catalog.images) {
    try {
      inspectDigest(exec, `${repository}:${version}`, { cwd: repoRoot });
      found.push(id);
    } catch (err) {
      if (!/not found|does not exist/i.test(err.message)) throw err;
    }
  }
  return found;
}

/**
 * 기준 매니페스트가 정말 기준 릴리스(`v<baseVersion>`)의 것인지 검사한다 — 다르면 throw(`source` 는 오류 메시지용 출처).
 * 승계(carry)는 이 digest 를 새 태그에 그대로 붙이므로 엉뚱한 릴리스·깨진 파일이면 다른 버전을 배포하게 된다.
 * 확인: schemaVersion 1, version 일치, images 가 객체, 각 항목의 repository(비어 있지 않은 문자열)·digest(sha256:<64hex>), commit 이 기준 태그의 커밋과 같을 것.
 */
export function validateBaseManifest({ manifest, baseVersion, exec, repoRoot, source = '기준 매니페스트' }) {
  if (!isPlainObject(manifest)) throw new Error(`${source}: 매니페스트가 객체가 아니다`);
  if (manifest.schemaVersion !== 1) throw new Error(`${source}: schemaVersion 은 1 이어야 한다 (${JSON.stringify(manifest.schemaVersion)})`);
  if (manifest.version !== baseVersion) throw new Error(`${source}: version(${JSON.stringify(manifest.version)})이 기준 릴리스(${baseVersion})와 다르다`);
  if (!isPlainObject(manifest.images)) throw new Error(`${source}: images 가 객체가 아니다`);
  for (const [id, entry] of Object.entries(manifest.images)) {
    if (!isPlainObject(entry)) throw new Error(`${source}: images.${id} 가 객체가 아니다`);
    if (typeof entry.repository !== 'string' || entry.repository === '') throw new Error(`${source}: images.${id}.repository 가 비어 있거나 문자열이 아니다 (${JSON.stringify(entry.repository)})`);
    if (!DIGEST_RE.test(entry.digest ?? '')) throw new Error(`${source}: images.${id}.digest 가 올바르지 않다 (${JSON.stringify(entry.digest)})`);
  }
  const tagCommit = exec('git', ['rev-parse', `v${baseVersion}^{commit}`], { cwd: repoRoot }).stdout.trim();
  if (manifest.commit !== tagCommit) {
    throw new Error(`${source}: commit(${manifest.commit})이 태그 v${baseVersion} 의 커밋(${tagCommit})과 다르다`);
  }
}

/**
 * dry-run 용 exec — git 은 실제로 실행하고(판정·명령을 실제 저장소 기준으로 보려고), docker 는 출력만 한다.
 * build 는 메타데이터 파일에 가짜 digest 를 써 주고, create 로 붙인 태그는 기억해 inspect 가 그 digest 를 돌려준다.
 */
export function dryRunExec(realExec, log, writeFile) {
  const tags = new Map();
  return (cmd, args, opts) => {
    if (cmd !== 'docker') return realExec(cmd, args, opts);
    log(`[dry-run] ${cmd} ${args.join(' ')}`);
    const line = args.join(' ');
    if (line.startsWith('buildx build')) {
      writeFile(args[args.indexOf('--metadata-file') + 1], JSON.stringify({ 'containerimage.digest': DRY_RUN_DIGEST }));
    } else if (line.startsWith('buildx imagetools create')) {
      tags.set(args[args.indexOf('-t') + 1], args.at(-1).split('@')[1]);
    } else if (line.startsWith('buildx imagetools inspect')) {
      return { stdout: JSON.stringify({ digest: tags.get(args[3]) }) };
    }
    return { stdout: '' };
  };
}

/**
 * 릴리스 하나를 빌드·태그하고 매니페스트를 돌려준다.
 * `base`(`{ baseTag, baseVersion }`)와 `baseManifest`(없으면 null)는 호출자가 findBase·검증으로 이미 정해 넘긴다 — 여기서는 다시 정하지 않는다.
 * baseManifest 가 null 이면 승계할 digest 가 없으므로 전부 새로 빌드한다(그래도 되는지는 호출자 몫). catalog·deps 를 생략하면 repoRoot 에서 읽는다.
 */
export function runRelease({ repoRoot, version, base, baseManifest = null, catalog = loadCatalog(repoRoot), deps = workspaceDeps(repoRoot), exec = defaultExec, now = new Date(), dryRun = false, log = console.error }) {
  assertVersion(version);
  if (!base) throw new Error('base({ baseTag, baseVersion })가 필요하다');
  if (dryRun) {
    exec = dryRunExec(exec, log, writeFileSync);
  }
  const git = (...args) => exec('git', args, { cwd: repoRoot }).stdout;

  // 1. 사전 검사: 작업 트리가 깨끗해야 "이 커밋의 이미지"라는 말이 성립한다.
  if (git('status', '--porcelain').trim() !== '') throw new Error('작업 트리가 깨끗하지 않다 (git status --porcelain 결과가 비어 있어야 한다)');
  const gitSha = git('rev-parse', 'HEAD').trim();
  if (!/^[0-9a-f]{40}$/.test(gitSha)) throw new Error(`GIT_SHA 는 40자 hex 여야 한다: ${JSON.stringify(gitSha)}`);
  // 릴리스 태그 `v<버전>` 이 HEAD 를 가리켜야 한다 — 태그 없이/다른 커밋에서 돌리면 :<버전> 이 태그와 무관한 코드를 가리키는 릴리스가 된다.
  // dry-run 은 아무것도 게시하지 않으므로(태그를 만들기 전에 미리 돌려 볼 수 있게) 건너뛴다.
  if (!dryRun) {
    let tagSha;
    try {
      tagSha = git('rev-parse', `v${version}^{commit}`).trim();
    } catch {
      throw new Error(`릴리스 태그 v${version} 이 없다. 릴리스 커밋에 태그를 먼저 만들어라 (git tag v${version})`);
    }
    if (tagSha !== gitSha) throw new Error(`릴리스 태그 v${version} 이 HEAD 를 가리키지 않는다 (태그 ${tagSha}, HEAD ${gitSha})`);
  }

  // 2. 변경 파일. 기준 태그가 있어도 매니페스트가 null 이면 비교할 수 없어 전부 build 다.
  const { baseTag } = base;
  const useBase = baseTag !== null && baseManifest !== null;
  // --no-renames: 옮겨진 파일의 옛 경로도 변경으로 나와야 한다(앱 경로 밖으로 옮겨진 파일이 가려지면 그 앱이 잘못 승계된다).
  // -z + core.quotePath=false: git 기본값은 비ASCII 경로를 따옴표·8진 이스케이프로 내보내 카탈로그 경로와 영영 맞지 않는다(변경을 놓쳐 잘못 승계).
  const changedFiles = useBase ? nulSplit(git('-c', 'core.quotePath=false', 'diff', '--name-only', '-z', '--no-renames', `${baseTag}..HEAD`)) : null;
  const plan = selectImages({ catalog, deps, changedFiles, baseManifest: useBase ? baseManifest : null });
  const byId = new Map(catalog.images.map((i) => [i.id, i]));

  // 승계할 digest 는 비싼 빌드·첫 태그 전에 전부 확인한다 — 깨진 기준 매니페스트로 일부 태그만 붙은 채 멈추지 않게(마지막 방어선).
  const digests = new Map();
  for (const { id, action } of plan) {
    if (action !== 'carry') continue;
    const digest = baseManifest.images[id]?.digest;
    if (!DIGEST_RE.test(digest ?? '')) throw new Error(`${id}: 기준 매니페스트의 digest 가 올바르지 않다 (${JSON.stringify(digest)})`);
    digests.set(id, digest);
  }

  // 3. 빌드. 하나라도 실패하면 `:<버전>` 태그가 하나도 없는 상태로 중단한다(릴리스가 반쪽으로 보이지 않게).
  const created = isoSeconds(now);
  const shaTag = `sha-${gitSha.slice(0, 12)}`;
  const workDir = mkdtempSync(join(tmpdir(), 'release-build-'));
  try {
    for (const { id } of plan.filter((p) => p.action === 'build')) {
      const image = byId.get(id);
      const metadataFile = join(workDir, `${id}.json`);
      const extra = Object.entries(image.buildArgs ?? {}).flatMap(([k, v]) => ['--build-arg', `${k}=${v}`]);
      exec('docker', [
        'buildx', 'build', '--platform', catalog.platform, '--push',
        '-t', `${image.repository}:${shaTag}`,
        '-f', join(repoRoot, image.dockerfile),
        '--build-arg', `APP_VERSION=${version}`, '--build-arg', `GIT_SHA=${gitSha}`, ...extra,
        '--label', `org.opencontainers.image.created=${created}`,
        '--metadata-file', metadataFile,
        join(repoRoot, image.context),
      ], { cwd: repoRoot, capture: false });
      const digest = JSON.parse(readFileSync(metadataFile, 'utf8'))['containerimage.digest'];
      if (!DIGEST_RE.test(digest ?? '')) throw new Error(`${id}: 빌드 메타데이터에서 digest 를 읽지 못했다 (${JSON.stringify(digest)})`);
      digests.set(id, digest);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  // 4. 모든 앱에 `:<버전>` 태그 — 빌드 앱은 새 digest, 승계 앱은 기준 digest. 중간 실패 시 일부 앱에만 태그가 남을 수 있고,
  //    다시 돌리면 빌드 앱은 `created` 라벨이 달라 새로 빌드된다. 그래서 CLI 가 이미 게시된 릴리스는 --force 없이 막는다.
  for (const { id } of plan) {
    const { repository } = byId.get(id);
    exec('docker', imagetoolsCreateArgs(`${repository}:${version}`, `${repository}@${digests.get(id)}`), { cwd: repoRoot });
  }

  // 5. 검증: 레지스트리에서 다시 읽은 태그의 digest 가 기대와 같아야 한다.
  for (const { id } of plan) {
    const { repository } = byId.get(id);
    const actual = inspectDigest(exec, `${repository}:${version}`, { cwd: repoRoot });
    if (actual !== digests.get(id)) throw new Error(`${id}: ${repository}:${version} 의 digest 가 기대와 다르다 (기대 ${digests.get(id)}, 실제 ${actual})`);
  }

  // 6. 매니페스트. 승계 앱의 builtVersion·builtCommit 은 기준 값을 잇는다(이미지가 실제로 빌드된 시점을 잃지 않게).
  const images = {};
  for (const { id, action, reasons } of plan) {
    const carried = action === 'carry' ? baseManifest.images[id] : null;
    images[id] = {
      repository: byId.get(id).repository,
      digest: digests.get(id),
      action,
      reasons,
      builtVersion: carried ? carried.builtVersion : version,
      builtCommit: carried ? carried.builtCommit : gitSha,
    };
    // buildArgs = 「이 이미지를 만든 인자」(다음 릴리스의 build-args 변경 감지 근거). 빌드 앱은 카탈로그 값, 승계 앱은 기준 값을 잇는다
    // (현재 카탈로그 값을 적으면 만들어지지 않은 인자를 기록하게 된다). 기준 항목에 없으면(구 매니페스트) 적지 않는다.
    if (!carried) images[id].buildArgs = byId.get(id).buildArgs ?? {};
    else if (carried.buildArgs !== undefined) images[id].buildArgs = { ...carried.buildArgs };
  }
  return { schemaVersion: 1, version, commit: gitSha, baseVersion: useBase ? baseTag.slice(1) : null, createdAt: created, images };
}
