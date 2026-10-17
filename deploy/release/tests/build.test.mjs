// 빌드·태그·매니페스트 오케스트레이션 테스트 (WP-440) — git·docker 는 전부 가짜 exec 로 대체한다(실제 실행 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { runRelease, findBase, findVersionTags, checkAlreadyPublished, validateBaseManifest, imagetoolsCreateArgs } from '../lib/build.mjs';
import { REPO, SHA, catalog, deps, NOW, repoOf, fakeDigest, baseManifest, makeExec, buildCalls, createCalls } from './helpers.mjs';

// runRelease 는 기준(base)과 기준 매니페스트를 호출자가 정해 넘긴다(CLI main 이 한 번에 결정). 테스트는 기본으로 v0.8.0 기준 + 전체 기준 매니페스트를 준다.
const BASE = { baseTag: 'v0.8.0', baseVersion: '0.8.0' };
const NO_BASE = { baseTag: null, baseVersion: null };
const opts = (exec, extra = {}) => ({ repoRoot: REPO, version: '0.9.0', exec, now: NOW, base: BASE, baseManifest: baseManifest(), catalog, deps, dryRun: false, log: () => {}, ...extra });

test('더러운 작업 트리 → throw, docker 호출 없음', () => {
  const exec = makeExec({ dirty: true });
  assert.throws(() => runRelease(opts(exec)), /작업 트리|clean|깨끗/);
  assert.equal(exec.docker().length, 0);
});

test('잘못된 버전(v0.9.0 · 0.9 · 빈 값) → throw, 아무것도 실행하지 않는다', () => {
  for (const version of ['v0.9.0', '0.9', '', undefined]) {
    const exec = makeExec();
    assert.throws(() => runRelease(opts(exec, { version })), /버전/);
    assert.equal(exec.calls.length, 0);
  }
});

test('GIT_SHA 가 40자 hex 가 아니면 빌드 전에 throw', () => {
  const exec = makeExec({ sha: 'abc123' });
  assert.throws(() => runRelease(opts(exec)), /40/);
  assert.equal(exec.docker().length, 0);
});

test('정상: 변경된 앱만 build, 모든 build 가 첫 imagetools create 보다 앞서고 인자가 규칙을 따른다', () => {
  const exec = makeExec({ diff: ['apps/workplace-api/src/A.java', 'db/V1.sql'] });
  const manifest = runRelease(opts(exec));
  const builds = buildCalls(exec);
  assert.deepEqual(builds.map((c) => c.args[c.args.indexOf('-t') + 1]).sort(), [`${repoOf('api')}:sha-${SHA.slice(0, 12)}`, `${repoOf('db')}:sha-${SHA.slice(0, 12)}`].sort());
  const firstCreate = exec.calls.findIndex((c) => c.cmd === 'docker' && c.args[2] === 'create');
  const lastBuild = exec.calls.findLastIndex((c) => c.cmd === 'docker' && c.args[1] === 'build');
  assert.ok(lastBuild < firstCreate, '모든 build 가 create 보다 먼저');
  const api = builds.find((c) => c.args.includes(`${repoOf('api')}:sha-${SHA.slice(0, 12)}`)).args;
  assert.equal(api[api.indexOf('--platform') + 1], 'linux/amd64');
  assert.ok(api.includes('--push'));
  assert.ok(api.includes('APP_VERSION=0.9.0'));
  assert.ok(api.includes(`GIT_SHA=${SHA}`));
  assert.ok(api.includes('org.opencontainers.image.created=2026-10-17T01:02:03Z'));
  assert.equal(api[api.indexOf('-f') + 1], join(REPO, 'apps/workplace-api/Dockerfile'));
  assert.equal(api.at(-1), join(REPO, 'apps/workplace-api'));
  assert.ok(!exec.docker().some((l) => l.includes(':latest')));
  assert.equal(manifest.images.api.action, 'build');
  assert.equal(manifest.images.api.builtVersion, '0.9.0');
  assert.equal(manifest.images.api.builtCommit, SHA);
});

test('web 의 catalog buildArgs(VITE_MCP_URL 빈 값)가 --build-arg 로 전달된다', () => {
  const exec = makeExec({ diff: ['apps/workplace-web/src/x.ts'] });
  runRelease(opts(exec));
  const web = buildCalls(exec).find((c) => c.args.some((a) => a.startsWith(repoOf('web'))));
  assert.ok(web.args.includes('VITE_MCP_URL='));
  assert.equal(web.args[web.args.indexOf('-f') + 1], join(REPO, 'apps/workplace-web/Dockerfile'));
  assert.equal(web.args.at(-1), join(REPO, '.'));
});

test('두 번째 빌드가 실패하면 imagetools create 는 한 번도 호출되지 않고 throw', () => {
  const exec = makeExec({ diff: ['apps/workplace-api/a', 'db/b'], failBuildAt: 2 });
  assert.throws(() => runRelease(opts(exec)), /빌드 실패/);
  assert.equal(buildCalls(exec).length, 2);
  assert.equal(createCalls(exec).length, 0);
});

test('carry 앱: create 소스가 <repo>@<기준 digest>, 매니페스트는 기준의 builtVersion·builtCommit 을 승계', () => {
  const base = baseManifest();
  const exec = makeExec({ diff: ['apps/workplace-api/a'] });
  const manifest = runRelease(opts(exec, { baseManifest: base }));
  const create = createCalls(exec).find((c) => c.args.includes(`${repoOf('mcp')}:0.9.0`));
  assert.equal(create.args.at(-1), `${repoOf('mcp')}@${base.images.mcp.digest}`);
  assert.equal(manifest.images.mcp.action, 'carry');
  assert.equal(manifest.images.mcp.digest, base.images.mcp.digest);
  assert.equal(manifest.images.mcp.builtVersion, '0.8.0');
  assert.equal(manifest.images.mcp.builtCommit, '1'.repeat(40));
  // 9개 앱 모두 :0.9.0 태그가 만들어진다.
  assert.equal(createCalls(exec).length, 9);
});

test('기준 매니페스트의 승계 digest 가 깨져 있으면 create·build 호출 0회, 앱 id 를 담아 throw', () => {
  for (const bad of [{}, { digest: 'sha256:abc' }]) {
    const base = baseManifest();
    base.images.mcp = bad;
    const exec = makeExec({ diff: ['apps/workplace-api/a'] });
    assert.throws(() => runRelease(opts(exec, { baseManifest: base })), /mcp/);
    assert.equal(createCalls(exec).length, 0);
    assert.equal(buildCalls(exec).length, 0);
  }
});

test('매니페스트 메타: schemaVersion·version·commit·baseVersion·createdAt(밀리초 없는 UTC)', () => {
  const exec = makeExec({ diff: [] });
  const manifest = runRelease(opts(exec));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.version, '0.9.0');
  assert.equal(manifest.commit, SHA);
  assert.equal(manifest.baseVersion, '0.8.0');
  assert.equal(manifest.createdAt, '2026-10-17T01:02:03Z');
  assert.deepEqual(Object.keys(manifest.images), catalog.images.map((i) => i.id));
  assert.equal(buildCalls(exec).length, 0);
  assert.equal(manifest.images.api.repository, repoOf('api'));
});

test('자기 자신의 태그(v0.9.0)는 기준에서 제외되고, git diff 는 <기준>..HEAD', () => {
  const exec = makeExec({ merged: ['v0.7.0', 'v0.8.0', 'v0.9.0'], diff: [] });
  const manifest = runRelease(opts(exec));
  assert.equal(manifest.baseVersion, '0.8.0');
  assert.ok(exec.calls.some((c) => c.cmd === 'git' && c.args.join(' ') === '-c core.quotePath=false diff --name-only -z --no-renames v0.8.0..HEAD'));
});

test('inspect digest 가 기대값과 다르면 throw', () => {
  const exec = makeExec({ diff: [], inspectOverride: { [`${repoOf('api')}:0.9.0`]: fakeDigest('다른 것') } });
  assert.throws(() => runRelease(opts(exec)), /digest/);
});

test('findBase: 조상 태그 없음 + 저장소에 다른 v* 태그 있음 → throw(GIT_DEPTH 언급), allowNoBase 면 기준 없음', () => {
  const mk = () => makeExec({ merged: [], allTags: ['v0.8.0'] });
  assert.throws(() => findBase({ exec: mk(), repoRoot: REPO, version: '0.9.0' }), /GIT_DEPTH/);
  assert.deepEqual(findBase({ exec: mk(), repoRoot: REPO, version: '0.9.0', allowNoBase: true }), NO_BASE);
});

test('findBase: 자기 태그(v0.9.0)만 있는 첫 릴리스 → allowNoBase 없이는 throw(자기 태그도 센다, 시드된 릴리스 위 재빌드 방지)', () => {
  const mk = () => makeExec({ merged: ['v0.9.0'], allTags: ['v0.9.0'] });
  assert.throws(() => findBase({ exec: mk(), repoRoot: REPO, version: '0.9.0' }), /--allow-no-base/);
  assert.deepEqual(findBase({ exec: mk(), repoRoot: REPO, version: '0.9.0', allowNoBase: true }), NO_BASE);
});

test('findBase: 얕은 clone 이면 throw(GIT_DEPTH 언급), docker 호출 없음', () => {
  const exec = makeExec({ shallow: true });
  assert.throws(() => findBase({ exec, repoRoot: REPO, version: '0.9.0' }), /GIT_DEPTH/);
  assert.equal(exec.docker().length, 0);
});

test('기준 태그가 없으면(NO_BASE) 기준 매니페스트가 주어져도 전부 build(no-base), 기준 버전은 null', () => {
  const exec = makeExec();
  const manifest = runRelease(opts(exec, { base: NO_BASE }));
  assert.equal(buildCalls(exec).length, 9);
  assert.equal(manifest.baseVersion, null);
  assert.deepEqual(manifest.images.api.reasons, ['no-base']);
  assert.ok(!exec.calls.some((c) => c.args.includes('diff')), '비교할 기준이 없으니 git diff 도 하지 않는다');
});

test('기준 매니페스트가 null 이면(호출자가 허용한 경우) 기준 태그가 있어도 전부 build(no-base), 기준 버전은 null', () => {
  const exec = makeExec();
  const manifest = runRelease(opts(exec, { baseManifest: null }));
  assert.equal(buildCalls(exec).length, 9);
  assert.equal(manifest.baseVersion, null);
  assert.deepEqual(manifest.images.api.reasons, ['no-base']);
});

test('base 를 주지 않으면 아무것도 실행하지 않고 throw — 기준은 호출자가 정해 넘겨야 한다', () => {
  const exec = makeExec();
  assert.throws(() => runRelease(opts(exec, { base: undefined })), /base/);
  assert.equal(exec.calls.length, 0);
});

test('catalog·deps 를 생략하면 저장소에서 읽어 같은 결과를 낸다', () => {
  const exec = makeExec({ diff: ['apps/workplace-api/a'] });
  const manifest = runRelease(opts(exec, { catalog: undefined, deps: undefined }));
  assert.equal(manifest.images.api.action, 'build');
  assert.equal(manifest.images.mcp.action, 'carry');
});

test('findBase: 조상 태그에서 기준 태그를 고른다', () => {
  assert.deepEqual(findBase({ exec: makeExec({ merged: ['v0.7.0', 'v0.10.0'] }), repoRoot: REPO, version: '0.11.0' }), { baseTag: 'v0.10.0', baseVersion: '0.10.0' });
  assert.deepEqual(findBase({ exec: makeExec({ merged: [], allTags: [] }), repoRoot: REPO, version: '0.1.0' }), { baseTag: null, baseVersion: null });
});

test('dry-run: docker 는 실행하지 않고 명령만 출력하며 가짜 digest 로 끝까지 진행, git 은 실제로 호출', () => {
  const exec = makeExec({ diff: ['apps/workplace-api/a'] });
  const logs = [];
  const manifest = runRelease(opts(exec, { dryRun: true, log: (l) => logs.push(l) }));
  assert.equal(exec.docker().length, 0, '실제 docker 호출 없음');
  assert.ok(exec.calls.some((c) => c.cmd === 'git' && c.args.includes('diff')), 'git 은 실제 호출');
  assert.ok(logs.some((l) => l.startsWith('[dry-run] docker buildx build')));
  assert.ok(logs.some((l) => l.startsWith('[dry-run] docker buildx imagetools create')));
  assert.equal(manifest.images.api.digest, `sha256:${'0'.repeat(64)}`);
  assert.equal(manifest.images.mcp.action, 'carry');
});

// ── 최종 리뷰 수정 (WP-440) ─────────────────────────────────────────────

test('모든 imagetools create(빌드 앱·승계 앱 모두)에 --prefer-index=false 가 있다 — 단일 매니페스트 digest 보존', () => {
  const exec = makeExec({ diff: ['apps/workplace-api/a'] });
  runRelease(opts(exec));
  const creates = createCalls(exec);
  assert.equal(creates.length, 9);
  for (const c of creates) assert.ok(c.args.includes('--prefer-index=false'), c.args.join(' '));
  assert.deepEqual(imagetoolsCreateArgs('t:1', 'r@sha256:x'), ['buildx', 'imagetools', 'create', '--prefer-index=false', '-t', 't:1', 'r@sha256:x']);
});

test('릴리스 태그가 없으면(실제 git 처럼 rev-parse 실패) docker 호출 없이 throw', () => {
  const exec = makeExec({ tagCommits: { 'v0.9.0': null } });
  assert.throws(() => runRelease(opts(exec)), /태그 v0\.9\.0/);
  assert.equal(exec.docker().length, 0);
});

test('릴리스 태그가 HEAD 가 아닌 다른 커밋을 가리키면 throw', () => {
  const exec = makeExec({ tagCommits: { 'v0.9.0': '2'.repeat(40) } });
  assert.throws(() => runRelease(opts(exec)), /HEAD/);
  assert.equal(exec.docker().length, 0);
});

test('dry-run 은 릴리스 태그가 없어도 통과한다(태그 확인 건너뜀)', () => {
  const exec = makeExec({ tagCommits: { 'v0.9.0': null } });
  assert.doesNotThrow(() => runRelease(opts(exec, { dryRun: true })));
  assert.ok(!exec.calls.some((c) => c.args.join(' ') === 'rev-parse v0.9.0^{commit}'));
});

test('비ASCII(한글) 경로도 -z + core.quotePath=false 로 그대로 받아 변경으로 잡는다', () => {
  const exec = makeExec({ diff: ['releases/0.9.0-한글.md', 'docs/x.md'] });
  const manifest = runRelease(opts(exec));
  assert.equal(manifest.images.web.action, 'build');
  assert.deepEqual(manifest.images.web.reasons, ['path:releases/']);
  assert.equal(manifest.images.api.action, 'carry');
  // 인용을 끄지 않았다면 fake 가 따옴표를 붙여 돌려주므로 위 단언이 실패한다 — 인자도 직접 확인한다.
  const diff = exec.calls.find((c) => c.args.includes('diff')).args;
  assert.deepEqual(diff.slice(0, 5), ['-c', 'core.quotePath=false', 'diff', '--name-only', '-z']);
});

test('빌드한 앱·승계한 앱 모두 매니페스트에 buildArgs 를 기록한다(카탈로그 값, 없으면 {})', () => {
  const exec = makeExec({ diff: ['apps/workplace-web/src/x.ts'] });
  const manifest = runRelease(opts(exec));
  assert.deepEqual(manifest.images.web.buildArgs, { VITE_MCP_URL: '' });
  assert.equal(manifest.images.web.action, 'build');
  assert.deepEqual(manifest.images.api.buildArgs, {});
  assert.equal(manifest.images.api.action, 'carry');
});

test('checkAlreadyPublished: 게시 없음 → 통과, 게시됨 → --force 없으면 throw, --force 면 경고만, dry-run 도 경고만', () => {
  const warns = [];
  const warn = (m) => warns.push(m);
  checkAlreadyPublished({ existing: null, version: '0.9.0', warn });
  assert.equal(warns.length, 0);

  assert.throws(() => checkAlreadyPublished({ existing: baseManifest(), version: '0.9.0', warn }), /--force/);
  assert.equal(warns.length, 0);

  checkAlreadyPublished({ existing: baseManifest(), version: '0.9.0', force: true, warn });
  assert.equal(warns.length, 1);
  assert.match(warns[0], /--force/);

  checkAlreadyPublished({ existing: baseManifest(), version: '0.9.0', dryRun: true, warn });
  assert.equal(warns.length, 2);
  assert.match(warns[1], /이미 게시/);
});

test('checkAlreadyPublished: action 으로 빌드/시드 문구를 고른다(--force 경고·중단 메시지), 레지스트리 태그만 남은 경우도 같은 규칙', () => {
  const warns = [];
  const warn = (m) => warns.push(m);
  checkAlreadyPublished({ existing: baseManifest(), version: '0.8.0', force: true, action: '시드', warn });
  assert.match(warns[0], /다시 시드한다.*원본 digest/);
  assert.throws(() => checkAlreadyPublished({ existing: baseManifest(), version: '0.8.0', action: '시드', warn }), /다시 시드하면 :0\.8\.0 태그가 다른 이미지로 옮겨 갈 수 있다.*--force/);
  assert.throws(() => checkAlreadyPublished({ existing: baseManifest(), version: '0.8.0', warn }), /다시 빌드하면 :0\.8\.0 태그가 다른 이미지로 옮겨 간다.*--force/);
  assert.throws(() => checkAlreadyPublished({ existing: null, taggedIds: ['api'], version: '0.9.0', warn }), /:0\.9\.0 태그가 이미 있는 앱이 있다\(api\)/);
});

test('validateBaseManifest: 올바른 매니페스트는 통과하고 schemaVersion·version·images·commit 불일치는 각각 throw', () => {
  const run = (patch, tagCommits) => validateBaseManifest({
    manifest: { ...baseManifest(), ...patch }, baseVersion: '0.8.0', exec: makeExec({ tagCommits }), repoRoot: REPO, source: '테스트',
  });
  assert.doesNotThrow(() => run({}));
  assert.throws(() => run({ schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => run({ version: '0.7.0' }), /version/);
  assert.throws(() => run({ images: [] }), /images/);
  assert.throws(() => run({ images: null }), /images/);
  assert.throws(() => run({ commit: '2'.repeat(40) }), /commit/);
  assert.throws(() => run({}, { 'v0.8.0': '3'.repeat(40) }), /commit/);
  assert.throws(() => run({}, { 'v0.8.0': null }));
  assert.throws(() => validateBaseManifest({ manifest: null, baseVersion: '0.8.0', exec: makeExec(), repoRoot: REPO }), /객체/);
});

// ── 코드 리뷰 수정 (WP-440) ─────────────────────────────────────────────

test('findVersionTags: 한 번도 push 된 적 없는 저장소(repository does not exist)는 태그 없음으로 보고, 그 밖의 실패는 그대로 던진다', () => {
  const failing = (message) => (cmd, args) => {
    if (cmd === 'docker' && args[1] === 'imagetools' && args[2] === 'inspect') {
      // converter 는 첫 릴리스라 저장소 자체가 없다 — 나머지 앱은 태그가 있다.
      if (args[3].startsWith(repoOf('converter'))) throw new Error(message);
      return { stdout: JSON.stringify({ digest: fakeDigest(args[3]) }) };
    }
    throw new Error(`예상 못한 호출: ${cmd}`);
  };
  const found = findVersionTags({ exec: failing('ERROR: docker.io/iacloudops/genia-works-converter:0.9.0: repository does not exist'), repoRoot: REPO, catalog, version: '0.9.0' });
  assert.ok(!found.includes('converter'));
  assert.equal(found.length, catalog.images.length - 1);

  assert.throws(() => findVersionTags({ exec: failing('unauthorized: authentication required'), repoRoot: REPO, catalog, version: '0.9.0' }), /unauthorized/);
});

test('findBase: v2-prototype·v0.9.0-rc1 같은 비릴리스 태그는 "다른 태그가 있다" 판정에 세지 않는다(--allow-no-base 불필요)', () => {
  const exec = makeExec({ merged: [], allTags: ['v2-prototype', 'v0.9.0-rc1', 'v1'] });
  assert.deepEqual(findBase({ exec, repoRoot: REPO, version: '0.9.0' }), { baseTag: null, baseVersion: null });
  // 릴리스 형식 태그(vX.Y.Z)가 섞여 있으면 여전히 막는다.
  const exec2 = makeExec({ merged: [], allTags: ['v2-prototype', 'v0.8.0'] });
  assert.throws(() => findBase({ exec: exec2, repoRoot: REPO, version: '0.9.0' }), /--allow-no-base/);
});

test('validateBaseManifest: images.<id> 의 repository·digest 가 없거나 틀리면 id 를 담아 throw', () => {
  const run = (mutate) => {
    const manifest = baseManifest();
    mutate(manifest.images);
    return validateBaseManifest({ manifest, baseVersion: '0.8.0', exec: makeExec(), repoRoot: REPO, source: '테스트' });
  };
  assert.throws(() => run((i) => { delete i.mcp.repository; }), /mcp.*repository/);
  assert.throws(() => run((i) => { i.mcp.repository = ''; }), /mcp.*repository/);
  assert.throws(() => run((i) => { i.mcp.repository = 7; }), /mcp.*repository/);
  assert.throws(() => run((i) => { delete i.web.digest; }), /web.*digest/);
  assert.throws(() => run((i) => { i.web.digest = 'sha256:abc'; }), /web.*digest/);
  assert.throws(() => run((i) => { i.db = null; }), /db/);
  assert.throws(() => run((i) => { i.db = 'x'; }), /db/);
});

test('runRelease: 기준은 호출자가 준 것을 그대로 쓴다(git 태그·얕은 clone 질의 0회), diff 는 <기준 태그>..HEAD', () => {
  // 태그가 하나도 없다고 답하는 exec 라도 주어진 base 로 비교한다 — runRelease 가 기준을 다시 정하면 결과가 달라진다.
  const exec = makeExec({ merged: [], allTags: [], diff: ['apps/workplace-api/a'] });
  const manifest = runRelease(opts(exec));
  assert.equal(manifest.baseVersion, '0.8.0');
  assert.equal(manifest.images.api.action, 'build');
  assert.equal(manifest.images.mcp.action, 'carry');
  assert.ok(!exec.calls.some((c) => c.cmd === 'git' && (c.args[0] === 'tag' || c.args.includes('--is-shallow-repository'))), 'git tag·얕은 clone 질의 없음');
  assert.ok(exec.calls.some((c) => c.cmd === 'git' && c.args.join(' ') === '-c core.quotePath=false diff --name-only -z --no-renames v0.8.0..HEAD'));
});

test('승계한 앱의 매니페스트 buildArgs 는 기준 항목의 것을 복사한다(기준에 없으면 필드를 적지 않는다), 빌드한 앱은 카탈로그 값', () => {
  const base = baseManifest();
  delete base.images.mcp.buildArgs;
  base.images.collab.buildArgs = { };
  const exec = makeExec({ diff: ['apps/workplace-web/src/x.ts'] });
  const manifest = runRelease(opts(exec, { baseManifest: base }));
  assert.equal(manifest.images.mcp.action, 'carry');
  assert.ok(!('buildArgs' in manifest.images.mcp));
  assert.equal(manifest.images.collab.action, 'carry');
  assert.deepEqual(manifest.images.collab.buildArgs, {});
  assert.notStrictEqual(manifest.images.collab.buildArgs, base.images.collab.buildArgs, '참조를 공유하지 않고 복사한다');
  assert.equal(manifest.images.web.action, 'build');
  assert.deepEqual(manifest.images.web.buildArgs, { VITE_MCP_URL: '' });
});
