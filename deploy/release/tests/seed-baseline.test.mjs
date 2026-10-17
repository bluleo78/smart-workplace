// 기준 릴리스 시드 테스트 (WP-440) — docker·네트워크는 가짜 exec/fetch 로 대체한다(실제 실행 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main, parseSources, seedBaseline } from '../seed-baseline.mjs';
import { uploadManifest } from '../lib/manifest-store.mjs';
import { NOW, REPO, catalog, createCalls, fakeDigest, makeTmp, repoOf } from './helpers.mjs';

const COMMIT = '699ddce2e86123fe522936c8198a2596515762f4';
const srcRepo = (id) => `ghcr.io/bluleo78/smart-workplace/${id === 'db' ? 'postgres' : id}`;

/** converter 를 뺀 운영 파드 소스 (id → 원본 digest ref). */
function sources(ids = catalog.images.map((i) => i.id).filter((id) => id !== 'converter')) {
  return new Map(ids.map((id) => [id, `${srcRepo(id)}@${fakeDigest(`src:${id}`)}`]));
}

/** docker 만 흉내 내는 가짜 exec(create 실패 주입용이라 helpers 의 makeExec 와 따로 둔다). create 는 태그→digest 를 기억하고 inspect 는 그것을 돌려준다(inspectOverride 로 어긋나게 할 수 있다). */
function makeExec({ inspectOverride = {}, failCreateAt = 0 } = {}) {
  const calls = [];
  const tags = new Map();
  let creates = 0;
  const exec = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const line = args.join(' ');
    if (line.startsWith('buildx imagetools create')) {
      creates += 1;
      if (creates === failCreateAt) throw new Error('create 실패');
      tags.set(args[args.indexOf('-t') + 1], args.at(-1).split('@')[1]);
      return { stdout: '' };
    }
    if (line.startsWith('buildx imagetools inspect')) {
      const ref = args[3];
      return { stdout: JSON.stringify({ digest: inspectOverride[ref] ?? tags.get(ref) }) };
    }
    throw new Error(`예상 못한 호출: ${cmd} ${line}`);
  };
  exec.calls = calls;
  return { exec, calls };
}

const run = (over = {}) => seedBaseline({ catalog, version: '0.8.0', commit: COMMIT, sources: sources(), now: NOW, ...over });

test('정상 복사: 매니페스트 모양과 create/inspect 명령', () => {
  const src = sources();
  const { exec, calls } = makeExec();
  const m = run({ sources: src, exec });
  assert.deepEqual(Object.keys(m), ['schemaVersion', 'version', 'commit', 'baseVersion', 'createdAt', 'images']);
  assert.equal(m.schemaVersion, 1);
  assert.equal(m.version, '0.8.0');
  assert.equal(m.commit, COMMIT);
  assert.equal(m.baseVersion, null);
  assert.equal(m.createdAt, '2026-10-17T01:02:03Z');
  for (const [id, ref] of src) {
    assert.deepEqual(m.images[id], {
      repository: repoOf(id), digest: ref.split('@')[1], action: 'carry', reasons: ['baseline'], builtVersion: '0.8.0', builtCommit: COMMIT,
      buildArgs: catalog.images.find((i) => i.id === id).buildArgs ?? {},
    });
    const create = calls.find((c) => c.args.join(' ').startsWith('buildx imagetools create') && c.args.includes(`${repoOf(id)}:0.8.0`));
    assert.deepEqual(create.args, ['buildx', 'imagetools', 'create', '--prefer-index=false', '-t', `${repoOf(id)}:0.8.0`, ref]);
    assert.ok(calls.some((c) => c.args.join(' ') === `buildx imagetools inspect ${repoOf(id)}:0.8.0 --format {{json .Manifest}}`));
  }
});

test('카탈로그 id 가 입력에 없으면(converter) 매니페스트에서 빠지고 create 도 하지 않는다', () => {
  const { exec, calls } = makeExec();
  const m = run({ exec });
  assert.equal('converter' in m.images, false);
  assert.equal(Object.keys(m.images).length, catalog.images.length - 1);
  assert.ok(!calls.some((c) => c.args.join(' ').includes(repoOf('converter'))));
});

test('inspect digest 가 원본과 다르면 해당 id 를 담아 throw', () => {
  const src = sources();
  const { exec } = makeExec({ inspectOverride: { [`${repoOf('web')}:0.8.0`]: fakeDigest('다른것') } });
  assert.throws(() => run({ sources: src, exec }), (err) => /web/.test(err.message) && /digest/.test(err.message));
});

test('모든 imagetools create 에 --prefer-index=false 가 있고, 매니페스트에 buildArgs(web 은 VITE_MCP_URL 빈 값, 나머지 {})가 기록된다', () => {
  const { exec, calls } = makeExec();
  const m = run({ exec });
  const creates = calls.filter((c) => c.args.join(' ').startsWith('buildx imagetools create'));
  assert.equal(creates.length, 8);
  for (const c of creates) assert.ok(c.args.includes('--prefer-index=false'), c.args.join(' '));
  assert.deepEqual(m.images.web.buildArgs, { VITE_MCP_URL: '' });
  assert.deepEqual(m.images.api.buildArgs, {});
});

test('카탈로그에 없는 id 는 어떤 create 도 하기 전에 throw', () => {
  const src = sources();
  src.set('nope', `ghcr.io/x/nope@${fakeDigest('n')}`);
  const { exec, calls } = makeExec();
  assert.throws(() => run({ sources: src, exec }), /nope/);
  assert.equal(calls.length, 0);
});

test('태그 ref·잘못된 digest 는 create 전에 throw', () => {
  for (const bad of ['ghcr.io/x/api:latest', 'ghcr.io/x/api@sha256:abc', `ghcr.io/x/api@sha256:${'A'.repeat(64)}`, '']) {
    const src = sources();
    src.set('api', bad);
    const { exec, calls } = makeExec();
    assert.throws(() => run({ sources: src, exec }), /api/, bad);
    assert.equal(calls.length, 0);
  }
});

test('버전·커밋 형식 오류는 create 전에 throw', () => {
  for (const over of [{ version: 'v0.8.0' }, { version: '0.8' }, { commit: 'abc' }, { commit: 'Z'.repeat(40) }]) {
    const { exec, calls } = makeExec();
    assert.throws(() => run({ ...over, exec }));
    assert.equal(calls.length, 0);
  }
});

test('create 가 실패하면 그대로 전파된다', () => {
  const { exec } = makeExec({ failCreateAt: 2 });
  assert.throws(() => run({ exec }), /create 실패/);
});

test('parseSources: 주석·빈 줄 무시, 중복 id·형식 오류는 throw', () => {
  const d = fakeDigest('a');
  const m = parseSources(`# 주석\n\napi ghcr.io/x/api@${d}\n  web   ghcr.io/x/web@${d}  \n`);
  assert.deepEqual([...m], [['api', `ghcr.io/x/api@${d}`], ['web', `ghcr.io/x/web@${d}`]]);
  assert.throws(() => parseSources(`api ghcr.io/x/api@${d}\napi ghcr.io/x/api@${d}`), /api/);
  assert.throws(() => parseSources('api'), /api/);
  assert.throws(() => parseSources(`api ghcr.io/x/api@${d} extra`), /3/);
});

test('--upload 흐름: 시드한 매니페스트를 업로드한다(가짜 fetch)', async () => {
  const { exec } = makeExec();
  const m = run({ exec });
  const seen = [];
  const fetch = async (url, init) => { seen.push({ url, init }); return { ok: true, status: 201 }; };
  await uploadManifest(m.version, m, { fetch, env: { CI_API_V4_URL: 'https://g/api/v4', CI_PROJECT_ID: '7', GITLAB_TOKEN: 't' } });
  assert.match(seen[0].url, /release-manifest\/0\.8\.0\/release-manifest\.json$/);
  assert.equal(JSON.parse(seen[0].init.body).images.api.action, 'carry');
});

// ── CLI main (코드 리뷰 수정, WP-440) ────────────────────────────────────

/** main 호출 도우미 — 입력 파일을 임시 폴더에 쓰고, 다운로드·업로드·로그를 주입한다. published 는 이미 게시된 매니페스트(없으면 null). */
function cli(args, { published = null, downloadFails = false, exec = makeExec().exec } = {}) {
  const dir = makeTmp('seed-test-');
  const images = join(dir, 'images.txt');
  const out = join(dir, 'm.json');
  writeFileSync(images, [...sources()].map(([id, ref]) => `${id} ${ref}`).join('\n'));
  const logs = [];
  const uploads = [];
  const downloads = [];
  const download = async (v) => {
    downloads.push(v);
    if (downloadFails) throw new Error('토큰 없음');
    return published;
  };
  const upload = async (v, m) => { uploads.push({ v, m }); };
  const run = () => main(['--version', '0.8.0', '--commit', COMMIT, '--images', images, '--out', out, ...args], { repoRoot: REPO, exec, download, upload, now: NOW, log: (l) => logs.push(l) });
  return { run, out, logs, uploads, downloads, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
test('main: 게시된 매니페스트가 없으면 시드하고 파일을 쓴 뒤 log 로 표를 낸다(--upload 면 업로드)', async () => {
  const { exec } = makeExec();
  const c = cli(['--upload'], { exec });
  const manifest = await c.run();
  assert.deepEqual(c.downloads, ['0.8.0']);
  assert.equal(createCalls(exec).length, 8);
  assert.deepEqual(JSON.parse(readFileSync(c.out, 'utf8')), manifest);
  assert.equal(c.uploads.length, 1);
  assert.ok(c.logs.some((l) => l.startsWith('\n기준 릴리스 0.8.0')));
  assert.ok(c.logs.some((l) => l.includes('매니페스트 업로드 완료')));
  c.cleanup();
});

test('main: 이미 게시된 매니페스트가 있으면 --force 없이는 create 전에 거부, --force 면 경고 후 진행, dry-run 도 경고만', async () => {
  const published = { schemaVersion: 1, version: '0.8.0' };
  const a = makeExec();
  const c = cli([], { published, exec: a.exec });
  await assert.rejects(c.run(), /이미 게시.*--force/);
  assert.equal(a.calls.length, 0);
  c.cleanup();

  const f = cli(['--force'], { published });
  await f.run();
  assert.ok(f.logs.some((l) => l.includes('--force')));
  f.cleanup();

  const b = makeExec();
  const d = cli(['--dry-run'], { published, exec: b.exec });
  await d.run();
  assert.ok(d.logs.some((l) => l.includes('이미 게시')));
  assert.equal(b.calls.length, 0, 'dry-run 은 실제 docker 를 부르지 않는다');
  d.cleanup();
});

test('main: 게시 여부 확인 실패 — --upload 하는 실제 실행은 중단, --upload 없는 로컬 시드와 dry-run 은 경고 후 진행', async () => {
  const a = makeExec();
  const up = cli(['--upload'], { downloadFails: true, exec: a.exec });
  await assert.rejects(up.run(), /토큰 없음/);
  assert.equal(a.calls.length, 0);
  assert.equal(up.uploads.length, 0);
  up.cleanup();

  const local = cli([], { downloadFails: true });
  const manifest = await local.run();
  assert.equal(manifest.version, '0.8.0');
  assert.ok(local.logs.some((l) => l.includes('게시 여부를 확인하지 못했다')));
  assert.equal(local.uploads.length, 0);
  local.cleanup();

  const dry = cli(['--dry-run', '--upload'], { downloadFails: true });
  await dry.run();
  assert.ok(dry.logs.some((l) => l.includes('게시 여부를 확인하지 못했다')));
  assert.ok(dry.logs.some((l) => l.includes('업로드는 건너뛴다')));
  assert.equal(dry.uploads.length, 0);
  dry.cleanup();
});
