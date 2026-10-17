// 체크리스트 CLI(checklist.mjs) 테스트 (WP-441) — 흐름은 가짜 exec, 마지막 한 건은 실제 저장소 git 으로 완료 기준 범위를 검증한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../checklist.mjs';
import { defaultExec } from '../lib/build.mjs';
import { REPO, baseManifest, catalog, makeTmp } from './helpers.mjs';

const MIGRATION_DIR = 'apps/workplace-api/src/main/resources/db/migration';
const TEMPLATE_DIR = 'deploy/helm/templates/';
const VALUES_FILE = 'deploy/helm/values.yaml';
const CATALOG_FILE = 'deploy/release/image-catalog.json';
const NUL = (list) => list.map((f) => `${f}\0`).join('');
const REAL_CATALOG_TEXT = readFileSync(join(REPO, CATALOG_FILE), 'utf8');
/** CLI 가 -U0 내용 diff 에만 붙이는 설정 고정 옵션(사용자·시스템 git 설정과 무관한 출력). 경로 목록(`--name-only -z`)에는 필요 없다. */
const CONTENT_DIFF = ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];

/**
 * 가짜 git. 호출을 기록하고 인자 모양으로 답한다:
 * 환경변수 diff(-U0) · 추가/수정·삭제 마이그레이션 · Helm 변경 파일 · 커밋 제목 · to 지점 템플릿·Dockerfile 목록(ls-tree)과 내용(show) ·
 * 얕은 clone 여부 · --from 이 가리키는 커밋 · --to 지점의 단일 파일(values.yaml·카탈로그: show, 없으면 git 처럼 `path ... does not exist` 오류).
 * values: values.yaml 본문(생략하면 --to 에 없음). catalog: 카탈로그 본문(기본은 실제 카탈로그, null 이면 --to 에 없음).
 */
function fakeGit({ diffText = '', added = [], changed = [], helmFiles = [], subjects = [], templates = {}, dockerfiles = {}, firstLines = {}, shallow = false, fromCommit = '1'.repeat(40), values, catalog: catalogText = REAL_CATALOG_TEXT } = {}) {
  const single = {};
  if (values !== undefined) single[VALUES_FILE] = values;
  if (catalogText !== null) single[CATALOG_FILE] = catalogText;
  const calls = [];
  const exec = (cmd, args) => {
    calls.push({ cmd, args });
    assert.equal(cmd, 'git', '체크리스트는 git 만 부른다');
    const line = args.join(' ');
    if (args.includes('-U0')) return { stdout: diffText };
    if (args.includes('--diff-filter=A')) return { stdout: NUL(added) };
    if (args.includes('--diff-filter=MD')) return { stdout: NUL(changed) };
    if (args[0] === 'rev-parse' && args[1] === '--is-shallow-repository') return { stdout: `${shallow}\n` };
    if (args[0] === 'rev-parse' && args[1].endsWith('^{commit}')) return { stdout: `${fromCommit}\n` };
    if (args.includes('--name-only') && args.includes('deploy/helm/')) return { stdout: NUL(helmFiles) };
    if (args[0] === 'log') return { stdout: subjects.map((s) => `${s}\n`).join('') };
    // apps/ 나열에는 Dockerfile 외의 파일과 한 단계 더 깊은 Dockerfile 이 섞여 있다 — CLI 가 apps/<앱>/Dockerfile* 만 골라야 한다.
    if (args[0] === 'ls-tree' && args.includes('apps/')) return { stdout: NUL([...Object.keys(dockerfiles), 'apps/workplace-api/build.gradle', 'apps/workplace-api/src/Dockerfile']) };
    if (args[0] === 'ls-tree') return { stdout: NUL(Object.keys(templates)) };
    if (args[0] === 'show') {
      const path = args[1].slice(args[1].indexOf(':') + 1);
      if (path in templates) return { stdout: templates[path] };
      if (path in dockerfiles) return { stdout: dockerfiles[path] };
      if (path in firstLines) return { stdout: `${firstLines[path]}\n두번째 줄\n` };
      if (path in single) return { stdout: single[path] };
      // 단일 파일 후보(values.yaml·카탈로그)가 그 지점에 없으면 실제 git 처럼 실패한다 — CLI 가 이를 null 로 받는다.
      if (path === VALUES_FILE || path === CATALOG_FILE) throw new Error(`git show ${args[1]} 실패 (종료 코드 128)\nfatal: path '${path}' does not exist in '${args[1].split(':')[0]}'`);
    }
    throw new Error(`예상 못한 git 호출: ${line}`);
  };
  exec.calls = calls;
  exec.find = (pred) => exec.calls.find((c) => pred(c.args))?.args;
  return exec;
}

function cli(args, git, { download = async () => null } = {}) {
  const dir = makeTmp('checklist-test-');
  const out = join(dir, 'c.md');
  const logs = [];
  const stdout = [];
  // main 은 마크다운을 stdout 으로도 내므로, 테스트 보고에 섞이지 않게 주입한 stdout 에 모아 둔다.
  const run = () => main(['--out', out, ...args], { repoRoot: REPO, exec: git, download, log: (l) => logs.push(l), stdout: (s) => stdout.push(String(s)) });
  return { run, out, dir, logs, stdout, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const envDiff = (file, line) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,0 +1 @@\n+${line}\n`;

test('git 인자: 두 점 트리 diff(내용 diff 만 설정 고정 옵션·quotePath=false·-U0·--no-renames, 환경변수는 apps/ 만), 경로 목록은 -z, from..to 로그를 쓴다', async () => {
  const git = fakeGit();
  const c = cli(['--from', 'v0.8.0', '--to', 'abc123'], git);
  await c.run();
  const diff = git.find((a) => a.includes('-U0'));
  assert.deepEqual(diff, [...CONTENT_DIFF, '-U0', '--no-renames', 'v0.8.0', 'abc123', '--', 'apps/']);
  const added = git.find((a) => a.includes('--diff-filter=A'));
  assert.deepEqual(added, ['diff', '--no-renames', '--diff-filter=A', '--name-only', '-z', 'v0.8.0', 'abc123', '--', MIGRATION_DIR]);
  const changed = git.find((a) => a.includes('--diff-filter=MD'));
  assert.deepEqual(changed, ['diff', '--no-renames', '--diff-filter=MD', '--name-only', '-z', 'v0.8.0', 'abc123', '--', MIGRATION_DIR]);
  const helm = git.find((a) => a.includes('--name-only') && a.includes('deploy/helm/'));
  assert.deepEqual(helm, ['diff', '--name-only', '-z', 'v0.8.0', 'abc123', '--', 'deploy/helm/']);
  assert.deepEqual(git.find((a) => a[0] === 'log'), ['log', '--format=%s', 'v0.8.0..abc123']);
  assert.deepEqual(git.find((a) => a[0] === 'ls-tree' && a.includes(TEMPLATE_DIR)), ['ls-tree', '-r', '--name-only', '-z', 'abc123', '--', TEMPLATE_DIR]);
  assert.deepEqual(git.find((a) => a[0] === 'ls-tree' && a.includes('apps/')), ['ls-tree', '-r', '--name-only', '-z', 'abc123', '--', 'apps/']);
  c.cleanup();
});

test('설정에 흔들리지 않는 diff: -U0 내용 diff 에만 --no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/ 가 붙고, 경로 목록 diff 는 -z 로 읽는다', async () => {
  const git = fakeGit({ added: [`${MIGRATION_DIR}/V9__a.sql`], firstLines: { [`${MIGRATION_DIR}/V9__a.sql`]: '-- 아홉' } });
  const c = cli(['--from', 'f', '--to', 't'], git);
  await c.run();
  const diffs = git.calls.filter((call) => call.args.includes('diff'));
  assert.equal(diffs.length, 4); // 환경변수 · 추가 · 수정/삭제 · Helm 변경
  for (const { args } of diffs) {
    if (args.includes('-U0')) assert.deepEqual(args.slice(0, CONTENT_DIFF.length), CONTENT_DIFF, args.join(' '));
    else assert.ok(args[0] === 'diff' && args.includes('--name-only') && args.includes('-z'), args.join(' '));
  }
  c.cleanup();
});

test('--to 를 생략하면 HEAD, 기본 출력은 저장소 루트의 release-checklist.md 다', async () => {
  const git = fakeGit();
  const dir = makeTmp('checklist-test-');
  try {
    await main(['--from', 'v0.8.0'], { repoRoot: dir, exec: git, download: async () => null, log: () => {}, stdout: () => {} });
    assert.ok(git.find((a) => a.includes('-U0')).includes('HEAD'));
    assert.match(readFileSync(join(dir, 'release-checklist.md'), 'utf8'), /^# 배포 체크리스트 v0\.8\.0 → HEAD/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Helm 내용은 --to 지점에서 읽는다(git show <to>:<path>) — 거기 있는 변수는 빠지고 없는 변수는 남는다', async () => {
  const diffText = envDiff('apps/workplace-api/src/main/resources/application.yml', 'a: ${IN_HELM}') + envDiff('apps/workplace-api/src/main/resources/application-prod.yml', 'b: ${NOT_IN_HELM}');
  const git = fakeGit({
    diffText,
    templates: { [`${TEMPLATE_DIR}api.yaml`]: 'env: IN_HELM', [`${TEMPLATE_DIR}web.yaml`]: 'x' },
  });
  const c = cli(['--from', 'f', '--to', 'abc123'], git);
  const md = (await c.run()).markdown;
  assert.ok(git.find((a) => a[0] === 'show' && a[1] === `abc123:${TEMPLATE_DIR}api.yaml`));
  assert.ok(!md.includes('`IN_HELM`'));
  assert.ok(md.includes('`NOT_IN_HELM`'));
  assert.ok(!md.includes('차트가 없어'));
  c.cleanup();
});

test('--to 지점에 템플릿이 없으면 Helm 비교를 건너뛴다고 알리고 변수를 그대로 둔다', async () => {
  const git = fakeGit({ diffText: envDiff('apps/x/application.yml', 'a: ${ANY_VAR}') });
  const c = cli(['--from', 'f', '--to', 't'], git);
  const { markdown } = await c.run();
  assert.ok(markdown.includes('이 지점에는 deploy/helm 차트가 없어 Helm 비교를 하지 않았다'));
  assert.ok(markdown.includes('`ANY_VAR`'));
  c.cleanup();
});

test('템플릿 파일끼리 이어 붙을 때 줄바꿈으로 구분한다 — 앞 파일 끝과 뒤 파일 처음이 붙어 변수명이 만들어지지 않는다', async () => {
  const git = fakeGit({
    diffText: envDiff('apps/x/application.yml', 'a: ${ABCDEF}'),
    templates: { [`${TEMPLATE_DIR}a.yaml`]: 'ABC', [`${TEMPLATE_DIR}b.yaml`]: 'DEF' },
  });
  const c = cli(['--from', 'f', '--to', 't'], git);
  assert.ok((await c.run()).markdown.includes('`ABCDEF`'));
  c.cleanup();
});

test('마이그레이션: 추가 파일을 --to 지점 첫 줄로 요약하고 롤백 경고를 낸다', async () => {
  const p9 = `${MIGRATION_DIR}/V9__a.sql`;
  const p10 = `${MIGRATION_DIR}/V10__b.sql`;
  const git = fakeGit({ added: [p10, p9], firstLines: { [p9]: '-- 아홉', [p10]: '-- 열' } });
  const c = cli(['--from', 'f', '--to', 'abc'], git);
  const { markdown } = await c.run();
  assert.ok(git.find((a) => a[0] === 'show' && a[1] === `abc:${p9}`));
  assert.ok(markdown.indexOf('V9__a.sql') < markdown.indexOf('V10__b.sql'));
  assert.ok(markdown.includes('— 아홉') && markdown.includes('— 열'));
  assert.ok(markdown.includes('> 롤백(helm rollback)해도 DB 스키마는 되돌아가지 않는다.'));
  c.cleanup();
});

test('포함 이슈와 Helm 변경 파일이 체크리스트에 실린다', async () => {
  const git = fakeGit({ subjects: ['feat(api): 가 (WP-1)', 'merge: 합 (WP-1)', 'chore: 나 (WP-2)'], helmFiles: ['deploy/helm/values.yaml'] });
  const c = cli(['--from', 'f', '--to', 't'], git);
  const { markdown } = await c.run();
  assert.ok(markdown.includes('- WP-1 — feat(api): 가 (WP-1)'));
  assert.ok(!markdown.includes('WP-2'));
  assert.ok(markdown.includes('`deploy/helm/values.yaml`'));
  c.cleanup();
});

test('파일·stdout·stderr: 마크다운을 --out 에 쓰고, 같은 내용을 stdout 으로 내며 진행 로그는 log(stderr)로만 낸다', async () => {
  const git = fakeGit();
  const c = cli(['--from', 'f', '--to', 't'], git);
  const result = await c.run();
  const file = readFileSync(c.out, 'utf8');
  assert.equal(file, result.markdown);
  assert.equal(c.stdout.join(''), file);
  assert.ok(c.logs.some((l) => l.includes(c.out)));
  assert.ok(c.logs.every((l) => !l.includes('# 배포 체크리스트')));
  c.cleanup();
});

test('기준 매니페스트: 없으면 새 앱을 판정하지 않고, --base-manifest 파일이면 카탈로그에 없는 앱을 새 앱으로 낸다', async () => {
  const none = cli(['--from', 'f', '--to', 't'], fakeGit());
  assert.ok((await none.run()).markdown.includes('기준 매니페스트 없음 — 판정하지 않음'));
  none.cleanup();

  const base = baseManifest();
  delete base.images.converter;
  const dir = makeTmp('checklist-base-');
  const baseFile = join(dir, 'base.json');
  writeFileSync(baseFile, JSON.stringify(base));
  const c = cli(['--from', 'f', '--to', 't', '--base-manifest', baseFile], fakeGit());
  const md = (await c.run()).markdown;
  assert.ok(md.includes('`converter` — Helm 템플릿 없음'));
  c.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

test('--base-version 은 downloadManifest 로 받고, 매니페스트가 없으면(null) 오류로 멈춘다', async () => {
  const asked = [];
  const base = baseManifest();
  delete base.images.converter;
  const c = cli(['--from', 'f', '--to', 't', '--base-version', '0.8.0'], fakeGit(), { download: async (v) => { asked.push(v); return base; } });
  assert.ok((await c.run()).markdown.includes('`converter`'));
  assert.deepEqual(asked, ['0.8.0']);
  c.cleanup();

  const missing = cli(['--from', 'f', '--to', 't', '--base-version', '0.8.0'], fakeGit());
  await assert.rejects(missing.run(), /0\.8\.0.*매니페스트/);
  missing.cleanup();
});

test('--base-manifest 와 --base-version 을 같이 주면 거부한다', async () => {
  const c = cli(['--from', 'f', '--base-manifest', 'x', '--base-version', '0.8.0'], fakeGit());
  await assert.rejects(c.run(), /함께/);
  c.cleanup();
});

test('기준 매니페스트의 images 가 객체가 아니면(배열·누락) 거부한다', async () => {
  const dir = makeTmp('checklist-bad-base-');
  try {
    for (const manifest of [{ images: [] }, { images: null }, {}]) {
      const baseFile = join(dir, 'base.json');
      writeFileSync(baseFile, JSON.stringify(manifest));
      const c = cli(['--from', 'f', '--to', 't', '--base-manifest', baseFile], fakeGit());
      await assert.rejects(c.run(), /기준 매니페스트에 images 가 없다/);
      c.cleanup();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--manifest 파일이 있으면 이미지 표를 싣고, --from 이 없으면 거부한다', async () => {
  const dir = makeTmp('checklist-m-');
  const mf = join(dir, 'm.json');
  writeFileSync(mf, JSON.stringify(baseManifest()));
  const c = cli(['--from', 'f', '--to', 't', '--manifest', mf], fakeGit());
  assert.ok((await c.run()).markdown.includes('| 앱 | 빌드/승계 |'));
  c.cleanup();
  rmSync(dir, { recursive: true, force: true });

  const noFrom = cli([], fakeGit());
  await assert.rejects(noFrom.run(), /--from/);
  noFrom.cleanup();
});

test('Dockerfile ENV: --to 지점의 apps/<앱>/Dockerfile* 만 읽어 TMPDIR·HOME·NODE_ENV 를 환경변수 목록에서 뺀다', async () => {
  const diffText =
    envDiff('apps/workplace-ai-agent/src/a.ts', 'const a = process.env.NODE_ENV; const b = process.env.HOME; const c = process.env.BRAND_NEW;') +
    envDiff('apps/workplace-converter/app/c.py', 'x = os.environ["TMPDIR"]; y = os.getenv("NESTED_ONLY")');
  const git = fakeGit({
    diffText,
    dockerfiles: {
      'apps/workplace-ai-agent/Dockerfile': 'ENV NODE_ENV=production\nENV HOME=/home/node\n',
      'apps/workplace-converter/Dockerfile.prod': 'ENV TMPDIR=/tmp\n',
    },
  });
  const c = cli(['--from', 'f', '--to', 'abc123'], git);
  const { markdown, sections } = await c.run();
  assert.deepEqual(sections.envVars.map((v) => v.name), ['BRAND_NEW', 'NESTED_ONLY']);
  assert.ok(git.find((a) => a[0] === 'show' && a[1] === 'abc123:apps/workplace-ai-agent/Dockerfile'));
  assert.ok(git.find((a) => a[0] === 'show' && a[1] === 'abc123:apps/workplace-converter/Dockerfile.prod'));
  // 앱 바로 아래가 아닌 Dockerfile(apps/workplace-api/src/Dockerfile)과 다른 파일은 읽지 않는다.
  assert.ok(!git.calls.some((c2) => c2.args[0] === 'show' && /build\.gradle|src\/Dockerfile/.test(c2.args[1])));
  assert.ok(markdown.includes('`BRAND_NEW` — 기본값 없음'));
  c.cleanup();
});

test('기존 마이그레이션 수정/삭제: 새 마이그레이션이 없어도 Flyway checksum 경고가 나오고 sections 에 담긴다', async () => {
  const git = fakeGit({ changed: [`${MIGRATION_DIR}/V30__b.sql`, `${MIGRATION_DIR}/V12__a.sql`, `${MIGRATION_DIR}/R__views.sql`] });
  const c = cli(['--from', 'f', '--to', 't'], git);
  const { markdown, sections } = await c.run();
  assert.ok(markdown.includes('- ⚠ 기존 마이그레이션 수정/삭제 — 운영 api 기동 실패(Flyway checksum) 위험: `V12__a.sql`, `V30__b.sql`'));
  assert.ok(!markdown.includes('## ⚠ DB 마이그레이션\n\n없음'));
  assert.deepEqual(sections.migrations, { added: [], changed: ['V12__a.sql', 'V30__b.sql'] });
  c.cleanup();
});

test('얕은 clone 이면 GIT_DEPTH: 0 안내와 함께 멈춘다', async () => {
  const c = cli(['--from', 'f', '--to', 't'], fakeGit({ shallow: true }));
  await assert.rejects(c.run(), /GIT_DEPTH: 0/);
  c.cleanup();
});

test('--from/--to 가 \'-\' 로 시작하면(git 옵션처럼 보이면) 거부하고 git 을 부르지 않는다', async () => {
  for (const args of [['--from=--output=/tmp/x'], ['--from', 'f', '--to=-x']]) {
    const git = fakeGit();
    const c = cli(args, git);
    await assert.rejects(c.run(), /'-' 로 시작할 수 없다/);
    assert.equal(git.calls.length, 0);
    c.cleanup();
  }
});

test('기준 매니페스트의 커밋이 --from 의 커밋과 다르면 log 로 경고하지만 멈추지 않는다', async () => {
  const dir = makeTmp('checklist-warn-');
  const baseFile = join(dir, 'base.json');
  writeFileSync(baseFile, JSON.stringify(baseManifest())); // commit = '1' * 40
  try {
    const git = fakeGit({ fromCommit: '2'.repeat(40) });
    const differs = cli(['--from', 'v0.8.0', '--to', 't', '--base-manifest', baseFile], git);
    await differs.run();
    assert.deepEqual(git.find((a) => a[0] === 'rev-parse' && a[1].endsWith('^{commit}')), ['rev-parse', 'v0.8.0^{commit}']);
    assert.equal(differs.logs.filter((l) => l.startsWith('경고:') && l.includes('1'.repeat(40)) && l.includes('2'.repeat(40))).length, 1);
    differs.cleanup();

    const same = cli(['--from', 'v0.8.0', '--to', 't', '--base-manifest', baseFile], fakeGit());
    await same.run();
    assert.ok(!same.logs.some((l) => l.startsWith('경고:')));
    same.cleanup();

    // 기준 매니페스트가 없으면 커밋 비교 자체를 하지 않는다.
    const none = fakeGit();
    const noBase = cli(['--from', 'f', '--to', 't'], none);
    await noBase.run();
    assert.ok(!none.calls.some((c) => c.args[0] === 'rev-parse' && c.args[1].endsWith('^{commit}')));
    noBase.cleanup();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('프로그램 사용: stdout 을 주입받고 { markdown, out, sections } 를 돌려준다(기본 process.stdout 은 건드리지 않는다)', async () => {
  const git = fakeGit({
    diffText: envDiff('apps/x/application.yml', 'a: ${K_NEW}'),
    added: [`${MIGRATION_DIR}/V9__a.sql`],
    firstLines: { [`${MIGRATION_DIR}/V9__a.sql`]: '-- 아홉' },
    helmFiles: ['deploy/helm/values.yaml'],
    subjects: ['feat(api): 가 (WP-1)'],
  });
  const c = cli(['--from', 'f', '--to', 't'], git);
  const result = await c.run();
  assert.equal(c.stdout.join(''), result.markdown);
  assert.equal(result.out, c.out);
  assert.deepEqual(Object.keys(result.sections).sort(), ['appsNote', 'envNote', 'envVars', 'helmChanges', 'issues', 'migrations', 'newApps']);
  assert.deepEqual(result.sections.envVars, [{ name: 'K_NEW', hasDefault: false, file: 'apps/x/application.yml' }]);
  assert.deepEqual(result.sections.migrations.added, [{ file: 'V9__a.sql', version: 9, summary: '아홉' }]);
  assert.deepEqual(result.sections.helmChanges, ['deploy/helm/values.yaml']);
  assert.deepEqual(result.sections.issues, [{ key: 'WP-1', subject: 'feat(api): 가 (WP-1)' }]);
  assert.equal(result.sections.newApps, null);
  assert.equal(result.sections.envNote, '이 지점에는 deploy/helm 차트가 없어 Helm 비교를 하지 않았다');
  assert.equal(result.sections.appsNote, null);
  c.cleanup();
});

test('existingSecretKeys: --to 지점 values.yaml 의 목록을 「이미 설정됨」으로 본다(없는 변수는 남는다)', async () => {
  const diffText = envDiff('apps/workplace-api/src/main/resources/application.yml', 'a: ${JWT_SECRET}') + envDiff('apps/workplace-api/src/main/resources/application-prod.yml', 'b: ${BRAND_NEW}');
  const values = 'existingSecret: s\nexistingSecretKeys:\n  - JWT_SECRET\n  - OTHER_KEY\nrelease:\n  version: ""\n';
  const git = fakeGit({ diffText, values });
  const c = cli(['--from', 'f', '--to', 'abc123'], git);
  const { sections } = await c.run();
  assert.deepEqual(sections.envVars.map((v) => v.name), ['BRAND_NEW']);
  assert.ok(git.find((a) => a[0] === 'show' && a[1] === `abc123:${VALUES_FILE}`));
  c.cleanup();
});

test('existingSecretKeys: --to 지점에 values.yaml 이 없으면(git show 실패 → null) 이름 없이 진행한다', async () => {
  const git = fakeGit({ diffText: envDiff('apps/x/application.yml', 'a: ${JWT_SECRET}') }); // values 없음
  const c = cli(['--from', 'f', '--to', 't'], git);
  const { sections } = await c.run();
  assert.deepEqual(sections.envVars.map((v) => v.name), ['JWT_SECRET']);
  assert.ok(git.find((a) => a[0] === 'show' && a[1] === `t:${VALUES_FILE}`)); // 존재 확인을 따로 하지 않고 show 한 번으로 판단
  c.cleanup();
});

test('주석에만 적힌 변수는 Helm 에 있는 것으로 치지 않는다(CLI: --to 지점 템플릿 주석)', async () => {
  const git = fakeGit({
    diffText: envDiff('apps/x/application.yml', 'a: ${ONLY_IN_COMMENT}') + envDiff('apps/x/application-prod.yml', 'b: ${REALLY_SET}'),
    templates: { [`${TEMPLATE_DIR}api.yaml`]: '# ONLY_IN_COMMENT 는 나중에\n- name: REALLY_SET\n' },
  });
  const c = cli(['--from', 'f', '--to', 't'], git);
  const { sections } = await c.run();
  assert.deepEqual(sections.envVars.map((v) => v.name), ['ONLY_IN_COMMENT']);
  c.cleanup();
});

test('카탈로그는 작업 트리가 아니라 --to 지점에서 읽는다(git show <to>:…) — 카탈로그 파일이 없는 repoRoot 에서도 동작', async () => {
  const smallCatalog = JSON.parse(REAL_CATALOG_TEXT);
  // --to 지점 카탈로그: 앱 둘(api·converter) + 작업 트리 카탈로그에 없는 앱 zeta — zeta 가 나오면 작업 트리가 아니라 --to 에서 읽은 것이다.
  const zeta = { id: 'zeta', repository: 'docker.io/iacloudops/genia-works-zeta', context: 'apps/zeta', dockerfile: 'apps/zeta/Dockerfile', paths: ['apps/zeta/'] };
  smallCatalog.images = [...smallCatalog.images.filter((i) => i.id === 'api' || i.id === 'converter'), zeta];
  const base = baseManifest();
  delete base.images.converter;
  const dir = makeTmp('checklist-catalog-at-to-');
  const baseFile = join(dir, 'base.json');
  writeFileSync(baseFile, JSON.stringify(base));
  try {
    const git = fakeGit({ catalog: JSON.stringify(smallCatalog) });
    const c = cli(['--from', 'f', '--to', 'abc123', '--base-manifest', baseFile], git);
    const { sections } = await c.run();
    assert.deepEqual(sections.newApps, [{ id: 'converter', helmMissing: true }, { id: 'zeta', helmMissing: true }]);
    assert.equal(sections.appsNote, null);
    assert.ok(git.find((a) => a[0] === 'show' && a[1] === `abc123:${CATALOG_FILE}`));
    c.cleanup();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--to 지점에 카탈로그가 없으면 새 앱은 null 이고 안내 줄이 새 앱 섹션에 나온다', async () => {
  const dir = makeTmp('checklist-no-catalog-');
  const baseFile = join(dir, 'base.json');
  writeFileSync(baseFile, JSON.stringify(baseManifest()));
  try {
    const c = cli(['--from', 'f', '--to', 'old', '--base-manifest', baseFile], fakeGit({ catalog: null }));
    const { markdown, sections } = await c.run();
    assert.equal(sections.newApps, null);
    assert.equal(sections.appsNote, '이 지점에는 deploy/release/image-catalog.json 이 없어 새 앱을 판정하지 않았다');
    assert.match(markdown, /## ⚠ 새 앱\n\n이 지점에는 deploy\/release\/image-catalog\.json 이 없어 새 앱을 판정하지 않았다\n/);
    assert.ok(!markdown.includes('기준 매니페스트 없음'));
    c.cleanup();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--to 지점 카탈로그가 깨졌으면 지점과 사유를 담아 멈춘다(validateCatalog 통과 필수)', async () => {
  const dir = makeTmp('checklist-bad-catalog-');
  const baseFile = join(dir, 'base.json');
  writeFileSync(baseFile, JSON.stringify(baseManifest()));
  try {
    for (const bad of ['{ not json', JSON.stringify({ schemaVersion: 2, images: [] })]) {
      const c = cli(['--from', 'f', '--to', 'abc123', '--base-manifest', baseFile], fakeGit({ catalog: bad }));
      await assert.rejects(c.run(), /abc123 지점의 deploy\/release\/image-catalog\.json 이 올바르지 않다/);
      c.cleanup();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('기준 매니페스트가 없으면 카탈로그를 읽지 않는다 — 새 앱 판정에만 쓰이므로 깨진 카탈로그가 체크리스트를 막지 않는다', async () => {
  const git = fakeGit({ catalog: '{ not json' });
  const c = cli(['--from', 'f', '--to', 't'], git);
  const { sections } = await c.run();
  assert.equal(sections.newApps, null);
  assert.equal(sections.appsNote, null);
  assert.ok(!git.calls.some((call) => call.args.includes(CATALOG_FILE) || (call.args[1] ?? '').endsWith(CATALOG_FILE)));
  c.cleanup();
});

test('--manifest 모양이 틀리면(images 항목의 필드 누락) 앱 id 를 담은 오류로 멈춘다', async () => {
  const dir = makeTmp('checklist-bad-manifest-');
  const mf = join(dir, 'm.json');
  const broken = baseManifest();
  delete broken.images.web.digest;
  writeFileSync(mf, JSON.stringify(broken));
  try {
    const c = cli(['--from', 'f', '--to', 't', '--manifest', mf], fakeGit());
    await assert.rejects(c.run(), /images\.web\.digest/);
    c.cleanup();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('얕은 clone 확인은 build.mjs 의 assertNotShallow 와 같은 문구·같은 git 호출을 쓴다', async () => {
  const git = fakeGit({ shallow: true });
  const c = cli(['--from', 'f', '--to', 't'], git);
  await assert.rejects(c.run(), /^Error: 얕은 clone 에서는 비교 범위를 판정할 수 없다\. 전체 이력을 받아라 \(CI: GIT_DEPTH: 0, 로컬: git fetch --unshallow --tags\)$/);
  assert.deepEqual(git.calls.map((call) => call.args), [['rev-parse', '--is-shallow-repository']]);
  c.cleanup();
});

// ---- 실제 git: 완료 기준 범위 (둘 다 origin 에 push 된 불변 커밋) ----
const FROM = '699ddce2e';
const TO = 'a5d66d059';
const gitOk = (...args) => spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });
const skipReason = (() => {
  if (gitOk('rev-parse', '--is-shallow-repository').stdout.trim() === 'true') return '저장소가 얕은 클론이라 완료 기준 범위를 검증할 수 없다';
  for (const sha of [FROM, TO]) if (gitOk('cat-file', '-e', sha).status !== 0) return `커밋 ${sha} 가 이 저장소에 없다`;
  return false;
})();

test('실제 git: 699ddce2e..a5d66d059 에서 WORKPLACE_CONVERTER_URL · V183~V185 · 롤백 경고 · WP-430 이 나오고, 카탈로그가 없는 지점이라 새 앱은 판정하지 않는다', { skip: skipReason, timeout: 60000 }, async () => {
  const base = baseManifest(); // 0.8.0 모양 — converter 가 빠져 있다
  assert.ok(catalog.images.some((i) => i.id === 'converter'));
  delete base.images.converter;
  const dir = makeTmp('checklist-real-');
  const baseFile = join(dir, 'base.json');
  writeFileSync(baseFile, JSON.stringify(base));
  const out = join(dir, 'c.md');
  // stdout 주입: 실제 범위 출력이 테스트 보고에 섞이지 않게
  const { markdown: md, sections } = await main(['--from', FROM, '--to', TO, '--base-manifest', baseFile, '--out', out], { repoRoot: REPO, exec: defaultExec, log: () => {}, stdout: () => {} });
  assert.equal(readFileSync(out, 'utf8'), md);
  // a5d66d059 에는 이미지 카탈로그가 없다(이후 WP-440 에서 생김) — 작업 트리의 카탈로그로 판정하지 않고 이유를 적는다.
  assert.equal(sections.newApps, null);
  assert.match(sections.appsNote, /image-catalog\.json 이 없어/);
  assert.ok(md.includes('이 지점에는 deploy/release/image-catalog.json 이 없어 새 앱을 판정하지 않았다'));
  assert.ok(md.includes('WORKPLACE_CONVERTER_URL'));
  for (const v of ['V183', 'V184', 'V185']) assert.ok(md.includes(v), v);
  assert.ok(md.includes('> 롤백(helm rollback)해도 DB 스키마는 되돌아가지 않는다.'));
  assert.ok(md.includes('WP-430'));
  assert.ok(!md.includes('TARGETARCH'));
  assert.ok(!md.includes('DOC_MAIL_ID'));
  assert.ok(md.includes('이 지점에는 deploy/helm 차트가 없어'));
  // Dockerfile ENV(TMPDIR·HOME 등)와 앱 밖 범위의 변수는 환경변수 목록에 섞이지 않는다.
  for (const noise of ['TMPDIR', 'E2E_', 'PLAYWRIGHT']) assert.ok(!sections.envVars.some((v) => v.name.includes(noise)), noise);
  assert.deepEqual(sections.migrations.added.map((m) => m.version).filter((v) => v >= 183 && v <= 185), [183, 184, 185]);
  rmSync(dir, { recursive: true, force: true });
});
