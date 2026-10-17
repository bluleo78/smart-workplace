// 이미지 카탈로그 로드·검증과 변경 감지용 경로 헬퍼 (WP-440).
// 카탈로그(deploy/release/image-catalog.json)는 "어떤 이미지를 어떤 입력으로 빌드하는가"의 단일 출처다.
// 모든 경로는 저장소 루트 기준 POSIX 경로다. context·dockerfile 도 루트 기준(빌드는 루트에서 `-f` 로 부른다).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CATALOG_FILE = 'deploy/release/image-catalog.json';
const REPOSITORY_PREFIX = 'docker.io/iacloudops/genia-works-';
/** 릴리스 빌드가 항상 직접 넘기는 build-arg — 카탈로그 buildArgs 로 덮어쓰지 못하게 한다. */
const RESERVED_BUILD_ARGS = ['APP_VERSION', 'GIT_SHA'];

/** null·배열이 아닌 일반 객체인가 — JSON 으로 읽은 값의 모양을 검사할 때 쓴다. */
export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * 카탈로그 객체를 검사한다 — 잘못되면 throw, 맞으면 그대로 돌려준다.
 * 막는 것: 스키마·플랫폼 불일치, id 중복, 저장소 이름 규칙 위반(id 와 어긋나면 Helm images 키와 이미지가 달라진다),
 * 빈 paths(변경 감지가 그 이미지를 영영 "변경 없음"으로 본다).
 */
export function validateCatalog(catalog) {
  if (catalog?.schemaVersion !== 1) throw new Error('카탈로그 schemaVersion 은 1 이어야 한다');
  if (catalog.platform !== 'linux/amd64') throw new Error('카탈로그 platform 은 linux/amd64 이어야 한다');
  if (!Array.isArray(catalog.images) || catalog.images.length === 0) throw new Error('카탈로그 images 가 비어 있다');
  const seen = new Set();
  for (const image of catalog.images) {
    const { id } = image;
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`잘못된 이미지 id: ${JSON.stringify(id)}`);
    if (seen.has(id)) throw new Error(`이미지 id 중복: ${id}`);
    seen.add(id);
    if (image.repository !== `${REPOSITORY_PREFIX}${id}`) {
      throw new Error(`${id}: repository 는 ${REPOSITORY_PREFIX}${id} 여야 한다 (실제: ${image.repository})`);
    }
    for (const key of ['context', 'dockerfile']) {
      if (typeof image[key] !== 'string' || image[key] === '') throw new Error(`${id}: ${key} 가 없다`);
    }
    if (!Array.isArray(image.paths) || image.paths.length === 0 || image.paths.some((p) => typeof p !== 'string' || p === '')) {
      throw new Error(`${id}: paths 는 비어 있지 않은 문자열 배열이어야 한다`);
    }
    if (image.buildArgs !== undefined) {
      const args = image.buildArgs;
      if (!isPlainObject(args) || Object.values(args).some((v) => typeof v !== 'string')) {
        throw new Error(`${id}: buildArgs 는 문자열 값의 객체여야 한다`);
      }
      // 이 둘은 빌드가 직접 넘기는 값이다(--build-arg 가 중복돼 어느 쪽이 이길지 모호해지고, 같은 커밋·버전이라는 보증이 깨진다).
      for (const key of RESERVED_BUILD_ARGS) {
        if (key in args) throw new Error(`${id}: buildArgs 에 예약된 키 ${key} 를 쓸 수 없다 (빌드가 직접 넘긴다)`);
      }
    }
  }
  return catalog;
}

/** 저장소의 카탈로그 파일을 읽어 검증한 뒤 돌려준다. */
export function loadCatalog(repoRoot) {
  return validateCatalog(JSON.parse(readFileSync(join(repoRoot, CATALOG_FILE), 'utf8')));
}

/**
 * 변경된 파일이 패턴에 걸리는가. 패턴이 `/` 로 끝나면 디렉터리 접두(그 아래 모든 파일), 아니면 정확한 파일 경로.
 * 글롭은 쓰지 않는다 — 의존성 없이 규칙을 단순하게 유지하고, 패턴 의미가 한눈에 읽히게 한다.
 */
export function matchesPath(file, pattern) {
  return pattern.endsWith('/') ? file.startsWith(pattern) : file === pattern;
}

/** package.json 이 있는 apps/*, packages/* 디렉터리를 {dir, pkg} 로 모은다. */
function readWorkspacePackages(repoRoot) {
  const found = [];
  for (const group of ['apps', 'packages']) {
    const base = join(repoRoot, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const file = join(base, entry.name, 'package.json');
      if (entry.isDirectory() && existsSync(file)) {
        found.push({ dir: `${group}/${entry.name}`, pkg: JSON.parse(readFileSync(file, 'utf8')) });
      }
    }
  }
  return found;
}

/**
 * 앱 디렉터리 → 전이 의존하는 워크스페이스 패키지 디렉터리 목록(`packages/x/`, 정렬됨).
 * 이미지는 앱 코드뿐 아니라 `workspace:` 로 묶인 공용 패키지도 담으므로, 패키지가 바뀌면 그 패키지를 쓰는 앱 이미지도 바뀐 것이다.
 * 이 목록을 카탈로그 paths 에 손으로 적지 않고 package.json 에서 계산해 의존이 늘어도 변경 감지가 따라가게 한다.
 * package.json 이 없는 디렉터리(db 등)는 키가 없다. 순환 의존이 있어도 방문 집합으로 끊는다.
 */
export function workspaceDeps(repoRoot) {
  const packages = readWorkspacePackages(repoRoot);
  const dirByName = new Map(packages.map(({ dir, pkg }) => [pkg.name, dir]));
  const pkgByDir = new Map(packages.map(({ dir, pkg }) => [dir, pkg]));

  /** 한 패키지가 직접 `workspace:` 로 참조하는 패키지 디렉터리들. */
  const direct = (pkg) => {
    const out = [];
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, range] of Object.entries(pkg[field] ?? {})) {
        if (typeof range === 'string' && range.startsWith('workspace:') && dirByName.has(name)) out.push(dirByName.get(name));
      }
    }
    return out;
  };

  const result = new Map();
  for (const { dir } of packages) {
    if (!dir.startsWith('apps/')) continue;
    const seen = new Set();
    const stack = direct(pkgByDir.get(dir));
    while (stack.length > 0) {
      const next = stack.pop();
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...direct(pkgByDir.get(next)));
    }
    result.set(dir, [...seen].sort().map((d) => `${d}/`));
  }
  return result;
}
