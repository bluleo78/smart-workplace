// 변경 감지(빌드/승계 판정) 테스트 (WP-440) — 어떤 파일이 바뀌면 어떤 이미지가 다시 빌드되는가.
// 실제 카탈로그와 워크스페이스 의존 계산 결과를 쓰고, 변경 파일·기준 매니페스트만 합성한다(git·docker 접근 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectImages } from '../lib/select.mjs';
import { catalog, deps } from './helpers.mjs';

/** 모든 이미지가 들어 있는 기준 매니페스트(except 로 일부를 뺄 수 있다). */
function manifestWith(except = []) {
  const images = {};
  for (const { id } of catalog.images) if (!except.includes(id)) images[id] = { digest: `sha256:${id}` };
  return { images };
}

/** 판정 결과를 id → 항목 맵으로 바꿔 단언을 짧게 한다. */
function run(changedFiles, baseManifest = manifestWith()) {
  const result = selectImages({ catalog, deps, changedFiles, baseManifest });
  return Object.fromEntries(result.map((r) => [r.id, r]));
}
const built = (r) => Object.values(r).filter((x) => x.action === 'build').map((x) => x.id);

test('기준 태그 없음(changedFiles null) → 전부 build, 사유 no-base', () => {
  const r = run(null, null);
  assert.equal(built(r).length, 9);
  for (const x of Object.values(r)) assert.deepEqual(x.reasons, ['no-base']);
});

test('기준 매니페스트가 없으면 변경 파일이 있어도 전부 build(no-base) — 승계할 digest 가 없다', () => {
  const r = run(['docs/x.md'], null);
  assert.equal(built(r).length, 9);
  for (const x of Object.values(r)) assert.deepEqual(x.reasons, ['no-base']);
});

test('결과는 카탈로그 순서를 따른다', () => {
  const result = selectImages({ catalog, deps, changedFiles: [], baseManifest: manifestWith() });
  assert.deepEqual(result.map((r) => r.id), catalog.images.map((i) => i.id));
});

test('기준 매니페스트에 없는 앱(converter)은 변경이 없어도 new-app 으로 build', () => {
  const r = run([], manifestWith(['converter']));
  assert.deepEqual(built(r), ['converter']);
  assert.deepEqual(r.converter.reasons, ['new-app']);
  assert.deepEqual(r.api, { id: 'api', action: 'carry', reasons: [] });
});

test('new-app 이면 경로 사유를 덧붙이지 않는다', () => {
  const r = run(['apps/workplace-converter/main.py'], manifestWith(['converter']));
  assert.deepEqual(r.converter.reasons, ['new-app']);
});

test('공용 패키지 변경 → 그 패키지를 쓰는 web·collab 만 build(workspace 사유)', () => {
  const r = run(['packages/wiki-editor-schema/src/x.ts']);
  assert.deepEqual(built(r).sort(), ['collab', 'web']);
  assert.deepEqual(r.web.reasons, ['workspace:packages/wiki-editor-schema/']);
  assert.deepEqual(r.collab.reasons, ['workspace:packages/wiki-editor-schema/']);
  assert.equal(r.mcp.action, 'carry');
  assert.equal(r['ai-agent'].action, 'carry');
});

test('pnpm-lock.yaml 변경 → Node 앱 5개만 build', () => {
  const r = run(['pnpm-lock.yaml']);
  assert.deepEqual(built(r).sort(), ['admin', 'ai-agent', 'collab', 'mcp', 'web']);
  assert.deepEqual(r.mcp.reasons, ['path:pnpm-lock.yaml']);
  for (const id of ['api', 'worker', 'converter', 'db']) assert.deepEqual(r[id], { id, action: 'carry', reasons: [] });
});

test('releases/0.9.0.md 변경 → web 만 build', () => {
  const r = run(['releases/0.9.0.md']);
  assert.deepEqual(built(r), ['web']);
  assert.deepEqual(r.web.reasons, ['path:releases/']);
});

test('db/Dockerfile 변경 → db 만 build', () => {
  const r = run(['db/Dockerfile']);
  assert.deepEqual(built(r), ['db']);
  assert.deepEqual(r.db.reasons, ['path:db/']);
});

test('docs/x.md 만 변경 → 전부 carry', () => {
  const r = run(['docs/x.md']);
  assert.deepEqual(built(r), []);
  for (const x of Object.values(r)) assert.deepEqual(x.reasons, []);
});

test('사유는 모두 모으되 중복 없이, 경로 사유 뒤에 워크스페이스 사유 순으로 나온다', () => {
  const r = run(['packages/wiki-editor-schema/a.ts', 'pnpm-lock.yaml', 'packages/wiki-editor-schema/b.ts', 'apps/workplace-web/src/a.ts']);
  assert.deepEqual(r.web.reasons, [
    'path:apps/workplace-web/',
    'path:pnpm-lock.yaml',
    'workspace:packages/wiki-editor-schema/',
  ]);
});

test('deps 에 키가 없는 앱(db)도 오류 없이 판정된다', () => {
  assert.equal(deps.has('db'), false);
  assert.doesNotThrow(() => run(['packages/mcp-tools-shared/a.ts']));
});

test('기준 항목의 repository 가 카탈로그와 다르면 변경이 없어도 build(repository-changed)', () => {
  const base = manifestWith();
  base.images.api.repository = 'ghcr.io/bluleo78/smart-workplace/api';
  const r = run([], base);
  assert.deepEqual(built(r), ['api']);
  assert.deepEqual(r.api.reasons, ['repository-changed']);
});

test('기준 항목의 buildArgs 가 카탈로그와 다르면 build(build-args), 키 순서만 다르면 같은 것으로 본다', () => {
  const base = manifestWith();
  base.images.web.buildArgs = { VITE_MCP_URL: 'https://x' }; // 카탈로그는 빈 값
  base.images.api.buildArgs = { EXTRA: '1' }; // 카탈로그는 없음({})
  const r = run([], base);
  assert.deepEqual(built(r).sort(), ['api', 'web']);
  assert.deepEqual(r.web.reasons, ['build-args']);
  assert.deepEqual(r.api.reasons, ['build-args']);

  const same = manifestWith();
  same.images.web.buildArgs = { VITE_MCP_URL: '' };
  same.images.api.buildArgs = {};
  assert.deepEqual(built(run([], same)), []);
});

test('기준 항목에 buildArgs 기록이 없으면(구 매니페스트·시드 이전) 알 수 없으므로 재빌드를 강제하지 않는다', () => {
  const r = run([], manifestWith()); // manifestWith 항목에는 buildArgs·repository 가 없다
  assert.deepEqual(built(r), []);
});

test('설정 사유와 경로 사유가 함께 걸리면 설정 사유가 앞에 모인다', () => {
  const base = manifestWith();
  base.images.web.buildArgs = { VITE_MCP_URL: 'https://x' };
  const r = run(['apps/workplace-web/src/a.ts'], base);
  assert.deepEqual(r.web.reasons, ['build-args', 'path:apps/workplace-web/']);
});
