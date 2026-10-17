// 빌드 CLI(build-images.mjs) 흐름 테스트 (WP-440) — exec·다운로드·업로드는 전부 가짜(실제 git·docker·네트워크 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../build-images.mjs';
import { REPO, baseManifest, buildCalls, fakeDigest, makeExec, makeTmp, repoOf } from './helpers.mjs';

/** main 호출 도우미 — 다운로드는 version → 매니페스트 맵(없으면 null), 업로드는 호출을 기록한다. */
function cli(args, { published = {}, exec = makeExec({ diff: ['apps/workplace-api/a'] }), downloadFails = false } = {}) {
  const dir = makeTmp('build-images-test-');
  const out = join(dir, 'm.json');
  const logs = [];
  const uploads = [];
  const downloads = [];
  const download = async (v) => {
    downloads.push(v);
    if (downloadFails) throw new Error('토큰 없음');
    return published[v] ?? null;
  };
  const upload = async (v, m) => { uploads.push({ v, m }); };
  const run = () => main(['--version', '0.9.0', '--out', out, ...args], { repoRoot: REPO, exec, download, upload, log: (l) => logs.push(l) });
  return { run, out, logs, uploads, downloads, exec, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
const withBase = { '0.8.0': baseManifest() };
// 레지스트리를 바꾸는 docker 호출(build·create) — 이미 게시 여부 확인용 읽기 전용 inspect 는 뺀다.
const mutatingDocker = (exec) => exec.docker().filter((l) => !l.startsWith('buildx imagetools inspect'));

test('이미 게시된 릴리스(같은 버전 매니페스트 존재)는 --force 없이 거부하고 docker 를 부르지 않는다', async () => {
  const c = cli([], { published: { ...withBase, '0.9.0': baseManifest() } });
  await assert.rejects(c.run(), /이미 게시/);
  assert.equal(mutatingDocker(c.exec).length, 0);
  c.cleanup();
});

test('--force 면 이미 게시된 릴리스도 경고만 하고 다시 빌드한다', async () => {
  const c = cli(['--force'], { published: { ...withBase, '0.9.0': baseManifest() } });
  const manifest = await c.run();
  assert.equal(manifest.images.api.action, 'build');
  assert.ok(c.logs.some((l) => l.includes('--force')));
  c.cleanup();
});

test('dry-run 은 이미 게시돼 있어도 경고만 하고 진행, 게시 여부를 확인 못 해도(토큰 없음) 경고 후 진행', async () => {
  const c = cli(['--dry-run'], { published: { ...withBase, '0.9.0': baseManifest() } });
  await c.run();
  assert.ok(c.logs.some((l) => l.includes('이미 게시')));
  c.cleanup();

  const c2 = cli(['--dry-run', '--allow-no-base'], { downloadFails: true, exec: makeExec({ merged: [], allTags: [] }) });
  await c2.run();
  assert.ok(c2.logs.some((l) => l.includes('게시 여부를 확인하지 못했다')));
  c2.cleanup();
});

test('dry-run 이 아닐 때 게시 여부를 확인하지 못하면(다운로드 실패) 중단한다', async () => {
  const c = cli([], { downloadFails: true });
  await assert.rejects(c.run(), /토큰 없음/);
  assert.equal(mutatingDocker(c.exec).length, 0);
  c.cleanup();
});

test('--upload: 매니페스트를 쓴 뒤 uploadManifest(version, manifest) 를 호출한다', async () => {
  const c = cli(['--upload'], { published: withBase });
  const manifest = await c.run();
  assert.equal(c.uploads.length, 1);
  assert.equal(c.uploads[0].v, '0.9.0');
  assert.deepEqual(c.uploads[0].m, manifest);
  assert.deepEqual(JSON.parse(readFileSync(c.out, 'utf8')), manifest);
  c.cleanup();
});

test('--upload 없으면 올리지 않고, dry-run 이면 --upload 여도 올리지 않는다', async () => {
  const a = cli([], { published: withBase });
  await a.run();
  assert.equal(a.uploads.length, 0);
  a.cleanup();

  const b = cli(['--upload', '--dry-run'], { published: withBase });
  await b.run();
  assert.equal(b.uploads.length, 0);
  assert.ok(b.logs.some((l) => l.includes('업로드는 건너뛴다')));
  assert.equal(mutatingDocker(b.exec).length, 0);
  b.cleanup();
});

test('다운로드한 기준 매니페스트가 기준 릴리스의 것이 아니면(version·commit 불일치) 빌드 전에 거부한다', async () => {
  for (const patch of [{ version: '0.7.0' }, { commit: '2'.repeat(40) }, { schemaVersion: 2 }]) {
    const c = cli([], { published: { '0.8.0': { ...baseManifest(), ...patch } } });
    await assert.rejects(c.run(), /GitLab 패키지 0\.8\.0/);
    assert.equal(mutatingDocker(c.exec).length, 0);
    c.cleanup();
  }
});

test('--base-manifest 파일에도 같은 검증을 한다(version 불일치 거부, 올바르면 통과)', async () => {
  const dir = makeTmp('build-images-test-');
  const bad = join(dir, 'bad.json');
  const good = join(dir, 'good.json');
  writeFileSync(bad, JSON.stringify({ ...baseManifest(), version: '0.7.0' }));
  writeFileSync(good, JSON.stringify(baseManifest()));

  const c = cli(['--base-manifest', bad]);
  await assert.rejects(c.run(), /bad\.json.*version/);
  assert.equal(mutatingDocker(c.exec).length, 0);
  c.cleanup();

  const ok = cli(['--base-manifest', good]);
  const manifest = await ok.run();
  assert.equal(manifest.baseVersion, '0.8.0');
  assert.ok(!ok.downloads.includes('0.8.0'), '파일을 줬으면 기준 매니페스트를 내려받지 않는다');
  ok.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

test('기준 태그는 있는데 매니페스트가 없으면(다운로드 null) main 이 거부한다', async () => {
  const c = cli([]);
  await assert.rejects(c.run(), /매니페스트/);
  assert.equal(buildCalls(c.exec).length, 0);
  c.cleanup();
});

for (const script of ['build-images.mjs', 'seed-baseline.mjs']) {
  test(`${script}: 심볼릭 링크로 실행해도 진입점으로 인식해 main 을 돈다(인자 오류 메시지·종료 코드 1)`, () => {
    const dir = makeTmp('build-images-test-');
    const link = join(dir, script);
    symlinkSync(fileURLToPath(new URL(`../${script}`, import.meta.url)), link);
    const r = spawnSync(process.execPath, [link], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /오류:/);
    rmSync(dir, { recursive: true, force: true });
  });
}

test('매니페스트는 없어도 레지스트리에 :<버전> 태그가 남아 있으면(태그 뒤 업로드 전에 멈춘 실행) --force 없이 거부한다', async () => {
  const leftover = { [`${repoOf('api')}:0.9.0`]: fakeDigest('leftover:api') };
  const c = cli([], { published: withBase, exec: makeExec({ diff: ['apps/workplace-api/a'], inspectOverride: leftover }) });
  await assert.rejects(c.run(), /:0\.9\.0 태그가 이미 있는 앱이 있다\(api\)/);
  assert.equal(buildCalls(c.exec).length, 0);
  c.cleanup();

  const f = cli(['--force'], { published: withBase, exec: makeExec({ diff: ['apps/workplace-api/a'], inspectOverride: leftover }) });
  await assert.rejects(f.run(), /digest/); // --force 로 진행하지만, 가짜 inspect 가 남은 digest 를 계속 돌려줘 검증 단계에서 어긋난다
  assert.ok(f.logs.some((l) => l.includes('--force')));
  assert.ok(buildCalls(f.exec).length > 0);
  f.cleanup();
});

test('레지스트리 태그 확인이 not found 가 아닌 이유로 실패하면 실제 실행은 중단하고 dry-run 은 경고 후 진행한다', async () => {
  const authFail = (base) => {
    const exec = (cmd, args, opts) => {
      if (cmd === 'docker' && args[1] === 'imagetools' && args[2] === 'inspect' && args[3].endsWith(':0.9.0')) throw new Error('unauthorized: authentication required');
      return base(cmd, args, opts);
    };
    exec.calls = base.calls;
    exec.docker = base.docker;
    return exec;
  };
  const c = cli([], { published: withBase, exec: authFail(makeExec({ diff: ['apps/workplace-api/a'] })) });
  await assert.rejects(c.run(), /unauthorized/);
  c.cleanup();

  const d = cli(['--dry-run'], { published: withBase, exec: authFail(makeExec({ diff: ['apps/workplace-api/a'] })) });
  await d.run();
  assert.ok(d.logs.some((l) => l.includes('태그를 확인하지 못했다')));
  d.cleanup();
});

// ── 기준 결정은 main 이 한 번에 (findBase · 매니페스트 · allow-no-base · dry-run 대체) ──

test('조상 태그 없음 + 저장소에 다른 v* 태그 있음 → GIT_DEPTH 로 거부, --allow-no-base 면 전부 build', async () => {
  const mk = () => makeExec({ merged: [], allTags: ['v0.8.0'] });
  const c = cli([], { exec: mk() });
  await assert.rejects(c.run(), /GIT_DEPTH/);
  assert.equal(mutatingDocker(c.exec).length, 0);
  c.cleanup();

  const ok = cli(['--allow-no-base'], { exec: mk() });
  const manifest = await ok.run();
  assert.equal(buildCalls(ok.exec).length, 9);
  assert.equal(manifest.baseVersion, null);
  assert.deepEqual(manifest.images.api.reasons, ['no-base']);
  ok.cleanup();
});

test('자기 태그(v0.9.0)만 있는 첫 릴리스 → --allow-no-base 없이는 거부, 있으면 전부 build', async () => {
  const mk = () => makeExec({ merged: ['v0.9.0'], allTags: ['v0.9.0'] });
  const c = cli([], { exec: mk() });
  await assert.rejects(c.run(), /--allow-no-base/);
  assert.equal(mutatingDocker(c.exec).length, 0);
  c.cleanup();

  const ok = cli(['--allow-no-base'], { exec: mk() });
  const manifest = await ok.run();
  assert.equal(buildCalls(ok.exec).length, 9);
  assert.equal(manifest.baseVersion, null);
  ok.cleanup();
});

test('dry-run 은 태그가 저장소에 전혀 없어도(태그 만들기 전 미리 돌려 보기) --allow-no-base 없이 전부 build', async () => {
  const c = cli(['--dry-run'], { exec: makeExec({ merged: [], allTags: [] }) });
  const manifest = await c.run();
  assert.equal(manifest.baseVersion, null);
  assert.equal(Object.values(manifest.images).filter((i) => i.action === 'build').length, 9);
  c.cleanup();
});

test('기준 태그는 있는데 매니페스트가 없어도 --allow-no-base 면 전부 build(no-base), 기준 버전은 null', async () => {
  const c = cli(['--allow-no-base']);
  const manifest = await c.run();
  assert.equal(buildCalls(c.exec).length, 9);
  assert.equal(manifest.baseVersion, null);
  c.cleanup();
});

test('얕은 clone 이면 GIT_DEPTH 로 거부한다(docker 호출 없음)', async () => {
  const c = cli([], { exec: makeExec({ shallow: true }) });
  await assert.rejects(c.run(), /GIT_DEPTH/);
  assert.equal(mutatingDocker(c.exec).length, 0);
  c.cleanup();
});

test('기준 태그가 있고 매니페스트가 정상이면 변경분만 build 하고 나머지는 기준 digest 를 승계한다(기준 버전 기록)', async () => {
  const c = cli([], { published: withBase });
  const manifest = await c.run();
  assert.equal(manifest.baseVersion, '0.8.0');
  assert.equal(manifest.images.api.action, 'build');
  assert.equal(manifest.images.mcp.action, 'carry');
  assert.equal(manifest.images.mcp.digest, withBase['0.8.0'].images.mcp.digest);
  c.cleanup();
});

// ── 코드 리뷰 수정 (WP-440) ─────────────────────────────────────────────

test('dry-run: 기준 매니페스트를 못 받으면(토큰 없음) 경고하고 기준 없이 끝까지 미리 본다(전부 build). 실제 실행은 throw', async () => {
  const c = cli(['--dry-run'], { downloadFails: true });
  const manifest = await c.run();
  assert.equal(manifest.baseVersion, null);
  assert.equal(Object.values(manifest.images).filter((i) => i.action === 'build').length, 9);
  assert.ok(c.logs.some((l) => l.includes('기준 없이 미리 본다')));
  assert.equal(mutatingDocker(c.exec).length, 0, 'dry-run 은 실제 docker 를 부르지 않는다');
  c.cleanup();

  const real = cli([], { downloadFails: true });
  await assert.rejects(real.run(), /토큰 없음/);
  real.cleanup();
});

test('기준은 main 에서 한 번만 정한다(얕은 clone 확인·git tag 질의가 각각 1회)', async () => {
  const c = cli([], { published: withBase });
  await c.run();
  const git = c.exec.calls.filter((x) => x.cmd === 'git').map((x) => x.args.join(' '));
  assert.equal(git.filter((l) => l === 'rev-parse --is-shallow-repository').length, 1);
  assert.equal(git.filter((l) => l.startsWith('tag ')).length, 1);
  c.cleanup();
});

test('기준 매니페스트 항목(repository·digest)이 깨져 있으면 다운로드본도 --base-manifest 파일도 빌드 전에 거부한다', async () => {
  const broken = baseManifest();
  delete broken.images.mcp.repository;
  const c = cli([], { published: { '0.8.0': broken } });
  await assert.rejects(c.run(), /GitLab 패키지 0\.8\.0.*mcp.*repository/);
  assert.equal(mutatingDocker(c.exec).length, 0);
  c.cleanup();

  const dir = makeTmp('build-images-test-');
  const file = join(dir, 'broken.json');
  const bad = baseManifest();
  bad.images.web.digest = 'sha256:abc';
  writeFileSync(file, JSON.stringify(bad));
  const f = cli(['--base-manifest', file]);
  await assert.rejects(f.run(), /broken\.json.*web.*digest/);
  assert.equal(mutatingDocker(f.exec).length, 0);
  f.cleanup();
  rmSync(dir, { recursive: true, force: true });
});
