// 이미지 카탈로그 검증(WP-440) — 카탈로그 스키마, Helm images 키와의 일치, Dockerfile COPY 커버리지.
// 지키는 것: 이미지에 들어가는 입력이 카탈로그 paths(+워크스페이스 의존)에 빠짐없이 걸려야 변경 감지가 이미지를 놓치지 않는다.
// docker·네트워크 없이 파일만 읽는다. node --test deploy/release/tests 로 돈다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog, matchesPath } from '../lib/catalog.mjs';
import { REPO, catalog, deps } from './helpers.mjs';

const HELM_IMAGES = fileURLToPath(new URL('../../helm/tests/images.fixture.yaml', import.meta.url));


/** 카탈로그 항목 하나를 복제해 필드를 덮어쓴 유효 카탈로그를 만든다(검증 실패 케이스용). */
function withImages(images) {
  return { schemaVersion: 1, platform: 'linux/amd64', images };
}
const OK = {
  id: 'api',
  repository: 'docker.io/iacloudops/genia-works-api',
  context: 'apps/workplace-api',
  dockerfile: 'apps/workplace-api/Dockerfile',
  paths: ['apps/workplace-api/'],
};

test('카탈로그 id 는 Helm images 키와 같다', () => {
  const helmIds = [...readFileSync(HELM_IMAGES, 'utf8').matchAll(/^  ([\w-]+):/gm)].map((m) => m[1]);
  assert.equal(catalog.images.length, 9);
  assert.deepEqual(catalog.images.map((i) => i.id).sort(), helmIds.sort());
});

test('카탈로그는 linux/amd64 단일 플랫폼이고 web 은 VITE_MCP_URL 을 빈 값으로 넘긴다', () => {
  assert.equal(catalog.platform, 'linux/amd64');
  const web = catalog.images.find((i) => i.id === 'web');
  assert.deepEqual(web.buildArgs, { VITE_MCP_URL: '' });
});

test('matchesPath: 슬래시로 끝나면 디렉터리 접두, 아니면 정확한 파일', () => {
  assert.equal(matchesPath('apps/workplace-web/src/a.ts', 'apps/workplace-web/'), true);
  assert.equal(matchesPath('apps/workplace-web-x/a.ts', 'apps/workplace-web/'), false);
  assert.equal(matchesPath('package.json', 'package.json'), true);
  assert.equal(matchesPath('package.json.bak', 'package.json'), false);
  assert.equal(matchesPath('apps/workplace-web/package.json', 'package.json'), false);
});

test('workspaceDeps: web·collab 등이 쓰는 공용 패키지를 돌려준다', () => {
  assert.deepEqual(deps.get('apps/workplace-web'), ['packages/mcp-tools-shared/', 'packages/wiki-editor-schema/']);
  assert.deepEqual(deps.get('apps/workplace-collab'), ['packages/wiki-editor-schema/']);
  assert.deepEqual(deps.get('apps/workplace-mcp'), ['packages/mcp-tools-shared/']);
  assert.deepEqual(deps.get('apps/workplace-ai-agent'), ['packages/mcp-tools-shared/']);
  assert.deepEqual(deps.get('apps/workplace-admin') ?? [], []);
});

test('검증: 중복 id·빈 paths·형식 오류 카탈로그는 throw 한다', () => {
  assert.doesNotThrow(() => validateCatalog(withImages([OK])));
  assert.throws(() => validateCatalog(withImages([OK, OK])), /중복/);
  assert.throws(() => validateCatalog(withImages([{ ...OK, paths: [] }])), /paths/);
  assert.throws(() => validateCatalog(withImages([{ ...OK, repository: 'ghcr.io/x/y' }])), /repository/);
  assert.throws(() => validateCatalog({ ...withImages([OK]), schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => validateCatalog({ ...withImages([OK]), platform: 'linux/arm64' }), /platform/);
});

test('검증: buildArgs 는 문자열 값의 일반 객체여야 한다(null·배열·비문자열 값 거부)', () => {
  for (const buildArgs of [null, ['A'], 'x', { A: 1 }]) {
    assert.throws(() => validateCatalog(withImages([{ ...OK, buildArgs }])), /buildArgs/, JSON.stringify(buildArgs));
  }
});

test('검증: buildArgs 에 예약된 키(APP_VERSION·GIT_SHA)를 쓰면 throw, 다른 키는 통과', () => {
  assert.doesNotThrow(() => validateCatalog(withImages([{ ...OK, buildArgs: { VITE_MCP_URL: '' } }])));
  for (const key of ['APP_VERSION', 'GIT_SHA']) {
    assert.throws(() => validateCatalog(withImages([{ ...OK, buildArgs: { [key]: 'x' } }])), new RegExp(key));
  }
});

/**
 * Dockerfile 의 COPY/ADD(--from 없는 것) 소스를 컨텍스트 기준 저장소 경로로 바꾼다.
 * 반환: { path, dir } — dir 이면 디렉터리 전체(`path/` 아래 모두)가 이미지로 들어간다.
 */
function copySources(image) {
  // 줄 끝 `\` 이음줄을 합친다(RUN 의 여러 줄 명령 안에 COPY 는 없지만 COPY 도 이어질 수 있다).
  const text = readFileSync(`${REPO}/${image.dockerfile}`, 'utf8').replace(/\\\r?\n/g, ' ');
  const found = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:COPY|ADD)\s+(.+)$/i);
    if (!m) continue;
    const tokens = m[1].trim().split(/\s+/);
    if (tokens.some((t) => t.startsWith('--from'))) continue; // 다른 스테이지에서 복사 — 빌드 컨텍스트 입력이 아니다
    const args = tokens.filter((t) => !t.startsWith('--'));
    for (const src of args.slice(0, -1)) {
      // JSON 배열 형식(`COPY ["a", "b"]`)은 이 단순 파서가 못 읽는다 — 조용히 엉뚱한 경로를 검사하지 말고 크게 실패시킨다.
      assert.ok(src !== '' && !src.startsWith('['), `${image.id}: 해석할 수 없는 COPY/ADD 소스 ${JSON.stringify(src)} (${line.trim()})`);
      const path = posix.normalize(posix.join(image.context, src));
      let dir = src.endsWith('/');
      try {
        dir ||= statSync(`${REPO}/${path}`).isDirectory();
      } catch {
        // 디스크에 없으면 파일로 본다(커버리지 판정은 그대로 한다)
      }
      found.push({ path: path.replace(/\/$/, ''), dir, src });
    }
  }
  return found;
}

/** 소스가 paths ∪ deps 에 걸리는가 — 디렉터리 소스는 그 디렉터리 전체를 덮는 디렉터리 패턴이 있어야 한다. */
function covered({ path, dir }, patterns) {
  return patterns.some((p) => (dir ? p.endsWith('/') && `${path}/`.startsWith(p) : matchesPath(path, p)));
}

for (const image of catalog.images) {
  test(`COPY 커버리지: ${image.id} 의 모든 컨텍스트 입력이 paths 에 걸린다`, () => {
    const appDir = posix.dirname(image.dockerfile);
    const patterns = [...image.paths, ...(deps.get(appDir) ?? [])];
    const sources = copySources(image);
    for (const s of sources) {
      assert.ok(covered(s, patterns), `${image.id}: ${s.src} → ${s.path} 가 paths 에 없음`);
    }
    // 컨텍스트가 저장소 루트면 루트 .dockerignore 도 빌드 입력이다(제외 규칙이 바뀌면 이미지 내용이 바뀐다).
    if (image.context === '.') assert.ok(image.paths.includes('.dockerignore'), `${image.id}: .dockerignore 누락`);
  });
}

test('COPY 커버리지 판정 자체: 빠진 경로는 걸러진다', () => {
  assert.equal(covered({ path: 'releases', dir: true }, ['apps/workplace-web/']), false);
  assert.equal(covered({ path: 'releases', dir: true }, ['releases/']), true);
  assert.equal(covered({ path: 'packages/mcp-tools-shared/src', dir: true }, ['packages/mcp-tools-shared/']), true);
  assert.equal(covered({ path: 'scripts/vite-app-version.mjs', dir: false }, ['scripts/']), true);
});
