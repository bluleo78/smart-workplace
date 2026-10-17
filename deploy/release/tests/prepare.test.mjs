// 릴리스 준비(prepare.mjs·lib/prepare.mjs) 테스트 (WP-444) — git 은 가짜 exec(실제 저장소·네트워크 없음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bumpOf, checkNote, nextVersion, parseCommits, summarize } from '../lib/prepare.mjs';
import { main, plan } from '../prepare.mjs';
import { REPO, makeTmp } from './helpers.mjs';

/** `git log --format=%H%x1f%s%x1f%b%x1e` 출력 모양을 만든다. */
const logOf = (...commits) => commits.map(([sha, subject, body = '']) => `${sha}\x1f${subject}\x1f${body}\x1e\n`).join('');
const sha = (c) => c.repeat(40);

test('parseCommits: 종류·scope·이슈 키(제목·Refs: 줄)·깨지는 변경·내부 여부', () => {
  const commits = parseCommits(logOf(
    [sha('a'), 'feat(api,web): 드라이브 미리보기 (WP-431)', '선례는 WP-96, 후속 WP-434\nRefs: WP-430'],
    [sha('b'), 'fix(api)!: 응답 형식을 바꾼다 (WP-12)'],
    [sha('c'), 'refactor(web): 정리', 'BREAKING CHANGE: 설정 이름 변경'],
    [sha('d'), 'feat(infra): 릴리스 도구 (WP-440)'],
    [sha('e'), 'feat(infra,web): 버전 표시 (WP-439)'],
    [sha('f'), '임시 커밋'],
  ));
  assert.deepEqual(commits.map((c) => [c.type, c.scope, c.keys, c.breaking, c.internal]), [
    ['feat', 'api,web', ['WP-430', 'WP-431'], false, false],
    ['fix', 'api', ['WP-12'], true, false],
    ['refactor', 'web', [], true, true],
    ['feat', 'infra', ['WP-440'], false, true],
    ['feat', 'infra,web', ['WP-439'], false, false],
    [null, null, [], false, false],
  ]);
  assert.equal(commits[0].sha, sha('a'));
});

test('parseCommits: 이슈 키는 번호 순으로 정렬하고 중복을 없앤다', () => {
  const [c] = parseCommits(logOf([sha('a'), 'fix(web): x (WP-10)', 'Refs: WP-9, WP-10']));
  assert.deepEqual(c.keys, ['WP-9', 'WP-10']);
});

test('bumpOf·nextVersion: 깨지는 변경 → major, feat → minor, 그 밖 → patch, 커밋 없음 → null', () => {
  const c = (subject, body) => parseCommits(logOf([sha('a'), subject, body]))[0];
  assert.equal(bumpOf([c('fix(web): x'), c('feat(api)!: y')]), 'major');
  // 내부 변경(배포 도구 feat·리팩터의 깨지는 변경)은 자리를 올리지 않는다
  assert.equal(bumpOf([c('fix(web): x'), c('feat(infra): 도구'), c('refactor(web)!: 정리', 'BREAKING CHANGE: 내부')]), 'patch');
  assert.equal(bumpOf([c('fix(web): x'), c('feat(api): y')]), 'minor');
  assert.equal(bumpOf([c('fix(web): x'), c('docs(repo): y')]), 'patch');
  assert.equal(bumpOf([]), null);
  assert.equal(nextVersion('0.8.0', 'minor'), '0.9.0');
  assert.equal(nextVersion('0.9.3', 'patch'), '0.9.4');
  assert.equal(nextVersion('0.9.3', 'major'), '0.10.0', '0.x 에서 깨지는 변경은 minor');
  assert.equal(nextVersion('1.4.2', 'major'), '2.0.0');
  assert.throws(() => nextVersion('v0.9.0', 'minor'), /잘못된 기준 버전/);
});

test('summarize: 이슈 키별로 묶고, 내부 커밋만 있는 이슈만 internal, 키 없는 커밋은 따로', () => {
  const { issues, unkeyed } = summarize(parseCommits(logOf(
    [sha('a'), 'feat(web): 화면 (WP-2)'],
    [sha('b'), 'test(web): 테스트 (WP-2)'],
    [sha('c'), 'test(api): 테스트만 (WP-3)'],
    [sha('d'), 'fix(web): 키 없음'],
  )));
  assert.deepEqual(issues.map((i) => [i.key, i.internal, i.subjects.length]), [['WP-2', false, 2], ['WP-3', true, 1]]);
  assert.deepEqual(unkeyed, [{ sha: 'dddddddddddd', subject: 'fix(web): 키 없음', internal: false }]);
});

test('checkNote: 앱 E2E fixture 노트는 통과한다(앱이 읽는 형식과 같다)', () => {
  for (const v of ['0.8.0', '0.9.0', '0.9.1']) {
    const raw = readFileSync(join(REPO, `apps/workplace-web/e2e/fixtures/releases/${v}.md`), 'utf8');
    assert.deepEqual(checkNote(`${v}.md`, raw), [], v);
  }
});

test('checkNote: 파일명·frontmatter·version·date·hidden·range·본문 문제를 모두 알려 준다', () => {
  assert.deepEqual(checkNote('README.md', '# x'), ['파일명이 <x.y.z>.md 가 아니다: README.md', '맨 앞에 --- 로 감싼 frontmatter 가 없다']);
  const bad = checkNote('0.9.0.md', '---\nversion: 0.9.1\ndate: 2026/10/17\nhidden: yes\nrange: v0.8.0\n---\n\n');
  assert.equal(bad.length, 5);
  assert.match(bad.join('\n'), /version\(0\.9\.1\)이 파일명\(0\.9\.0\)/);
  assert.match(bad.join('\n'), /date 가 YYYY-MM-DD/);
  assert.match(bad.join('\n'), /hidden 은 true 나 false/);
  assert.match(bad.join('\n'), /range 는/);
  assert.match(bad.join('\n'), /본문이 비었다/);
  assert.deepEqual(checkNote('0.9.0.md', '---\nversion: "0.9.0"\ndate: 2026-10-17\nrange: v0.8.0..abc123\nhidden: false\n---\n\n## 드라이브\n- 미리보기\n'), []);
});

/** plan 에 필요한 git 질의만 답하는 가짜 exec. */
function gitFake({ tags = ['v0.8.0', 'v0.9.0', 'v0.9.1'], allTags = tags, pointsAt = [], branch = 'main', log = logOf([sha('a'), 'feat(web): x (WP-1)']) } = {}) {
  const calls = [];
  const exec = (cmd, args) => {
    const line = args.join(' ');
    calls.push(line);
    if (line === 'rev-parse --is-shallow-repository') return { stdout: 'false\n' };
    if (line.startsWith('tag --merged')) return { stdout: tags.join('\n') };
    // 브랜치 이름 — HEAD 는 branch 옵션, 그 밖에는 받은 ref 그대로
    if (line.startsWith('rev-parse --abbrev-ref')) return { stdout: `${args[2] === 'HEAD' ? branch : args[2]}\n` };
    if (line.startsWith('tag --points-at')) return { stdout: pointsAt.join('\n') };
    if (line.startsWith('tag --list v')) return { stdout: allTags.filter((t) => t === args[2]).join('\n') };
    if (line.startsWith('rev-parse --verify')) return { stdout: `${line.includes('HEAD') || line.includes('main') ? sha('f') : sha('1')}\n` };
    if (line.startsWith('log --no-merges')) return { stdout: log };
    throw new Error(`예상 못한 git 호출: ${line}`);
  };
  exec.calls = calls;
  return exec;
}

test('plan: 조상 태그 중 가장 높은 것을 기준으로, 제안 버전·range·이슈 요약을 낸다', () => {
  const exec = gitFake();
  const r = plan({ exec, repoRoot: REPO });
  assert.equal(r.base, 'v0.9.1');
  assert.equal(r.baseVersion, '0.9.1');
  assert.equal(r.suggestedVersion, '0.10.0');
  assert.equal(r.range, `v0.9.1..${sha('f').slice(0, 12)}`);
  assert.deepEqual(r.issues.map((i) => i.key), ['WP-1']);
  assert.ok(exec.calls.includes(`log --no-merges --format=%H%x1f%s%x1f%b%x1e ${sha('1')}..${sha('f')}`));
});

test('plan: 태그가 없으면 --base/--base-version 을 요구하고, 주면 그 커밋 기준으로 range 에 커밋 12자를 쓴다', () => {
  assert.throws(() => plan({ exec: gitFake({ tags: [] }), repoRoot: REPO }), /--base <커밋> --base-version 0\.8\.0/);
  assert.throws(() => plan({ base: '699ddce2e', exec: gitFake({ tags: [] }), repoRoot: REPO }), /함께 준다/);
  assert.throws(() => plan({ base: '699ddce2e', baseVersion: 'v0.8.0', exec: gitFake({ tags: [] }), repoRoot: REPO }), /잘못된 --base-version/);
  const r = plan({ base: '699ddce2e', baseVersion: '0.8.0', to: 'main', exec: gitFake({ tags: [] }), repoRoot: REPO });
  assert.equal(r.suggestedVersion, '0.9.0');
  assert.equal(r.range, `${sha('1').slice(0, 12)}..${sha('f').slice(0, 12)}`);
});

test('plan: 제안 버전의 태그가 이미 있으면(뒤처진 main·핫픽스 라인) 제안하지 않고 conflict 로 알린다', () => {
  const r = plan({ exec: gitFake({ tags: ['v0.9.0'], allTags: ['v0.9.0', 'v0.9.1'], log: logOf([sha('a'), 'fix(web): x (WP-1)']) }), repoRoot: REPO });
  assert.equal(r.suggestedVersion, null);
  assert.match(r.conflict, /v0\.9\.1 태그가 이미 있는데/);
});

test('plan: --to 자신에 붙은 태그는 기준에서 뺀다(이미 찍은 태그 미리보기)', () => {
  const r = plan({ to: 'v0.9.1', exec: gitFake({ pointsAt: ['v0.9.1'], allTags: [] }), repoRoot: REPO });
  assert.equal(r.base, 'v0.9.0');
});

test('plan: hotfix/* 브랜치는 기능 커밋이 있어도 patch 만 제안한다', () => {
  assert.equal(plan({ to: 'hotfix/0.9.2', exec: gitFake({ tags: ['v0.9.1'], allTags: [] }), repoRoot: REPO }).suggestedVersion, '0.9.2');
  // HEAD 가 핫픽스 브랜치여도 같다(브랜치 이름으로 판정)
  assert.equal(plan({ exec: gitFake({ tags: ['v0.9.1'], allTags: [], branch: 'hotfix/0.9.2' }), repoRoot: REPO }).suggestedVersion, '0.9.2');
});

test('plan: 커밋이 없으면 제안 버전 없음', () => {
  const r = plan({ exec: gitFake({ log: '' }), repoRoot: REPO });
  assert.equal(r.bump, null);
  assert.equal(r.suggestedVersion, null);
});

test('main: plan 은 JSON 을 stdout 으로, check-note 는 문제를 모아 throw, 기준보다 낮은 버전은 거부', async () => {
  let out = '';
  await main(['plan'], { exec: gitFake(), repoRoot: REPO, stdout: (s) => { out += s; }, log: () => {} });
  assert.equal(JSON.parse(out).suggestedVersion, '0.10.0');

  const dir = makeTmp('prepare-test-');
  try {
    mkdirSync(join(dir, 'releases'));
    const file = join(dir, 'releases', '0.9.0.md');
    const outside = join(dir, '0.9.0.md');
    writeFileSync(outside, '---\nversion: 0.9.0\ndate: 2026-10-17\n---\n\n- x\n');
    await assert.rejects(main(['check-note', outside], { repoRoot: dir, log: () => {} }), /저장소 루트 releases\//);
    writeFileSync(file, '---\nversion: 0.9.0\ndate: 2026-10-17\n---\n\n## 드라이브\n- 미리보기\n');
    await main(['check-note', file, '--base-version', '0.8.0'], { repoRoot: dir, log: () => {} });
    await assert.rejects(main(['check-note', file, '--base-version', '0.9.0'], { repoRoot: dir, log: () => {} }), /0\.9\.0 은 기준 0\.9\.0 보다 높아야/);
    writeFileSync(file, '---\nversion: 0.9.0\n---\n');
    await assert.rejects(main(['check-note', file], { repoRoot: dir, log: () => {} }), /date 가 YYYY-MM-DD[\s\S]*본문이 비었다/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  await assert.rejects(main(['check-note'], { log: () => {} }), /노트 파일 하나/);
  await assert.rejects(main(['plan', 'extra'], { exec: gitFake(), log: () => {} }), /위치 인자/);
  await assert.rejects(main(['publish'], { log: () => {} }), /사용법/);
});
