// CLI 공용 도구(lib/cli.mjs) 테스트 (WP-440) — 임시 폴더만 쓰고 네트워크·docker 는 쓰지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultManifestPath, defaultOutPath, finishManifest, isMainModule, isoSeconds, tolerate, withTempDir, writeManifestReport } from '../lib/cli.mjs';
import { serializeManifest } from '../lib/manifest-store.mjs';
import { REPO, fakeDigest, makeTmp } from './helpers.mjs';

test('writeManifestReport: 들여쓰기 2칸 + 끝 개행으로 쓰고, 제목 줄과 앱별 표를 log 로 낸다', () => {
  const dir = makeTmp('cli-test-');
  const out = join(dir, 'm.json');
  const digest = fakeDigest('a');
  const manifest = { schemaVersion: 1, version: '0.9.0', images: { api: { action: 'build', reasons: ['path:apps/workplace-api/'], digest }, mcp: { action: 'carry', reasons: [], digest } } };
  const logs = [];
  writeManifestReport({ manifest, out, log: (l) => logs.push(l), title: '릴리스 0.9.0 (기준 0.8.0)' });
  const text = readFileSync(out, 'utf8');
  assert.equal(text, serializeManifest(manifest));
  assert.equal(text, `${JSON.stringify(manifest, null, 2)}\n`);
  assert.deepEqual(JSON.parse(text), manifest);
  assert.equal(logs[0], `\n릴리스 0.9.0 (기준 0.8.0) → ${out}`);
  assert.equal(logs.length, 3);
  assert.match(logs[1], /^ {2}api {7}build {2}sha256:[0-9a-f]{12} {2}path:apps\/workplace-api\/$/);
  assert.match(logs[2], /^ {2}mcp {7}carry {2}sha256:/);
  rmSync(dir, { recursive: true, force: true });
});

test('isMainModule: argv[1] 이 이 파일(심볼릭 링크 경유 포함)이면 true, 다른 파일이면 false, argv[1] 이 없으면 false', () => {
  // macOS 의 tmpdir 은 /var → /private/var 심볼릭 링크라, import.meta.url 에 해당하는 실제 경로로 맞춘다.
  const dir = realpathSync(makeTmp('cli-test-'));
  const real = join(dir, 'real.mjs');
  const link = join(dir, 'link.mjs');
  writeFileSync(real, '');
  symlinkSync(real, link);
  const saved = process.argv[1];
  try {
    const url = pathToFileURL(real).href;
    process.argv[1] = real;
    assert.equal(isMainModule(url), true);
    process.argv[1] = link;
    assert.equal(isMainModule(url), true);
    process.argv[1] = fileURLToPath(import.meta.url);
    assert.equal(isMainModule(url), false);
    process.argv[1] = '';
    assert.equal(isMainModule(url), false);
  } finally {
    process.argv[1] = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isoSeconds: 밀리초 없는 UTC ISO8601', () => {
  assert.equal(isoSeconds(new Date('2026-10-17T01:02:03.456Z')), '2026-10-17T01:02:03Z');
});

test('defaultManifestPath: 저장소 루트의 release-manifest.json, 루트 .gitignore 가 무시한다', () => {
  assert.equal(defaultManifestPath('/r'), '/r/release-manifest.json');
  assert.equal(defaultOutPath('/r', 'release-checklist.md'), '/r/release-checklist.md');
  assert.ok(readFileSync(join(REPO, '.gitignore'), 'utf8').split('\n').includes('/release-manifest.json'));
});

test('tolerate: when 이면 경고 후 fallback(동기·비동기 모두), 아니면 그대로 던진다, 성공하면 값을 돌려준다', async () => {
  const logs = [];
  const log = (l) => logs.push(l);
  const boom = () => { throw new Error('실패'); };
  assert.equal(await tolerate({ when: true, log, what: '확인하지 못했다' }, boom, 'fb'), 'fb');
  assert.equal(await tolerate({ when: true, log, what: '비동기' }, async () => { throw new Error('늦은 실패'); }, null), null);
  assert.deepEqual(logs, ['경고: 확인하지 못했다 (실패)', '경고: 비동기 (늦은 실패)']);
  await assert.rejects(tolerate({ when: false, log, what: 'x' }, boom, 'fb'), /실패/);
  await assert.rejects(tolerate({ when: false, log, what: 'x' }, async () => { throw new Error('늦은 실패'); }, 'fb'), /늦은 실패/);
  assert.equal(await tolerate({ when: true, log, what: 'x' }, async () => 'ok', 'fb'), 'ok');
  assert.equal(logs.length, 2);
});

test('finishManifest: 파일을 쓰고 표를 낸 뒤 --upload 이고 dry-run 이 아닐 때만 올린다(dry-run 이면 건너뛴다는 로그)', async () => {
  const dir = makeTmp('cli-test-');
  const manifest = { version: '0.9.0', images: { api: { action: 'build', reasons: [], digest: fakeDigest('a') } } };
  const run = async (opts) => {
    const logs = [];
    const uploads = [];
    await finishManifest({ manifest, out: join(dir, 'm.json'), title: 'T', log: (l) => logs.push(l), uploadFn: async (v, m) => { uploads.push({ v, m }); }, ...opts });
    return { logs, uploads };
  };
  const plain = await run({ upload: false, dryRun: false });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'm.json'), 'utf8')), manifest);
  assert.equal(plain.uploads.length, 0);
  assert.ok(!plain.logs.some((l) => l.includes('업로드')));

  const real = await run({ upload: true, dryRun: false });
  assert.deepEqual(real.uploads, [{ v: '0.9.0', m: manifest }]);
  assert.equal(real.logs.at(-1), '매니페스트 업로드 완료');

  const dry = await run({ upload: true, dryRun: true });
  assert.equal(dry.uploads.length, 0);
  assert.equal(dry.logs.at(-1), '[dry-run] 매니페스트 업로드는 건너뛴다');
  rmSync(dir, { recursive: true, force: true });
});

test('withTempDir: baseDir 아래 <prefix>XXXXXX 를 만들어 넘기고, 동기 fn 이면 동기로 결과를 돌려준 뒤 지운다(던져도 지운다)', () => {
  const base = makeTmp('cli-tempdir-');
  try {
    let seen;
    const r = withTempDir(base, 'work-', (dir) => {
      seen = dir;
      assert.ok(dir.startsWith(join(base, 'work-')));
      assert.ok(existsSync(dir));
      return 42;
    });
    assert.equal(r, 42, 'Promise 가 아니라 값 그대로');
    assert.ok(!existsSync(seen));
    assert.throws(() => withTempDir(base, 'work-', () => {
      throw new Error('boom');
    }), /boom/);
    assert.deepEqual(readdirSync(base), []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('withTempDir: fn 이 Promise 를 돌려주면 끝난 뒤(성공·실패 모두) 지운다', async () => {
  const base = makeTmp('cli-tempdir-');
  try {
    let seen;
    const p = withTempDir(base, 'work-', async (dir) => {
      seen = dir;
      await new Promise((r) => setImmediate(r));
      assert.ok(existsSync(dir), '끝나기 전에는 남아 있다');
      return 'ok';
    });
    assert.equal(await p, 'ok');
    assert.ok(!existsSync(seen));
    await assert.rejects(withTempDir(base, 'work-', async () => {
      throw new Error('async boom');
    }), /async boom/);
    assert.deepEqual(readdirSync(base), []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
