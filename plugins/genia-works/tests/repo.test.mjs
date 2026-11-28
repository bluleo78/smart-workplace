// gw-repo 테스트(WP-1276) — 가짜 gh·glab 로 호스트 종류 판정, GitHub 은 지금까지와 같은 gh 명령, GitLab 은 같은 뜻의 REST 호출과
// 공통 JSON 모양을 확인한다.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', 'scripts', 'gw-repo');
let root, bin, repo, log, replies, runDir;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gw-repo-'));
  bin = join(root, 'bin');
  mkdirSync(bin);
  chmodSync(join(here, 'fake-cli'), 0o755);
  for (const n of ['gh', 'glab']) symlinkSync(join(here, 'fake-cli'), join(bin, n));
  repo = join(root, 'repo');
  mkdirSync(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });
  log = join(root, 'log');
  writeFileSync(log, '');
  replies = join(root, 'replies.json');
  writeFileSync(replies, '{}');
  runDir = join(root, 'run');
  mkdirSync(runDir);
});

function origin(url) {
  spawnSync('git', ['remote', 'add', 'origin', url], { cwd: repo });
}
function reply(map) {
  writeFileSync(replies, JSON.stringify(map));
}
function run(args, { path = `${bin}:${process.env.PATH}`, env = {} } = {}) {
  return spawnSync(script, args, {
    cwd: repo,
    encoding: 'utf8',
    env: { PATH: path, HOME: root, GENIA_RUN_DIR: runDir, FAKE_CLI_LOG: log, FAKE_CLI_REPLIES: replies, TMPDIR: root, ...env },
  });
}
function calls() {
  return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

test('kind: github 주소는 github, 그 밖의 호스트는 gitlab, git config 가 먼저, Pod 토큰 폴더가 이름 짐작보다 먼저', () => {
  origin('git@github.com:a/wp.git');
  assert.equal(run(['kind']).stdout.trim(), 'github');
  spawnSync('git', ['remote', 'set-url', 'origin', 'https://gitlab.iacloud.kr/t/ttp.git'], { cwd: repo });
  assert.equal(run(['kind']).stdout.trim(), 'gitlab');
  // 이름에 github 가 없는 GitHub Enterprise — Pod 이면 토큰 폴더가 알려 준다.
  spawnSync('git', ['remote', 'set-url', 'origin', 'https://code.example.com/a/b'], { cwd: repo });
  mkdirSync(join(runDir, 'repo-tokens', 'github'), { recursive: true });
  writeFileSync(join(runDir, 'repo-tokens', 'github', 'code.example.com'), 't');
  assert.equal(run(['kind']).stdout.trim(), 'github');
  spawnSync('git', ['config', 'genia-works.repoKind', 'gitlab'], { cwd: repo });
  assert.equal(run(['kind']).stdout.trim(), 'gitlab');
});

test('origin 이 없거나 이상한 주소면 종료 2', () => {
  assert.equal(run(['kind']).status, 2);
  origin('https://github.com/a/b;rm -rf');
  assert.equal(run(['kind']).status, 2);
});

test('GitHub pr-list: 지금까지의 gh 명령 그대로, 검사·충돌·리뷰를 공통 모양으로', () => {
  origin('https://github.com/a/wp.git');
  reply({
    'gh pr list': {
      out: [
        {
          number: 12, title: 'WP-1 x', body: '개발: ai', url: 'https://github.com/a/wp/pull/12', headRefName: 'WP-1', headRefOid: 'abc',
          state: 'OPEN', mergeable: 'CONFLICTING', reviewDecision: '', mergeCommit: null,
          statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }],
        },
        {
          number: 13, title: 'WP-2 y', body: '', url: 'u', headRefName: 'WP-2', headRefOid: 'def', state: 'OPEN', mergeable: 'MERGEABLE',
          reviewDecision: 'CHANGES_REQUESTED', mergeCommit: null,
          statusCheckRollup: [{ __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' }, { __typename: 'StatusContext', state: 'SUCCESS' }],
        },
        { number: 14, title: 'z', body: '', url: 'u', headRefName: 'b', headRefOid: 'g', state: 'OPEN', mergeable: 'UNKNOWN', reviewDecision: 'APPROVED', mergeCommit: null, statusCheckRollup: [] },
      ],
    },
  });
  const r = run(['pr-list']);
  assert.equal(r.status, 0, r.stderr);
  const prs = JSON.parse(r.stdout);
  assert.deepEqual(prs.map((p) => [p.number, p.mergeable, p.checks, p.reviewDecision]), [
    [12, 'CONFLICTING', 'FAIL', null],
    [13, 'MERGEABLE', 'PENDING', 'CHANGES_REQUESTED'],
    [14, 'UNKNOWN', 'NONE', 'APPROVED'],
  ]);
  assert.equal(prs[0].body, '개발: ai');
  const [c] = calls();
  assert.equal(c.name, 'gh');
  assert.deepEqual(c.args.slice(0, 4), ['pr', 'list', '--state', 'open']);
});

test('GitHub pr-list --all --search: 이슈 키를 제목·본문에서 찾는다', () => {
  origin('https://github.com/a/wp.git');
  reply({ 'gh pr list': { out: [] } });
  assert.equal(run(['pr-list', '--all', '--search', 'WP-7']).stdout.trim(), '[]');
  const [c] = calls();
  assert.deepEqual(c.args.slice(0, 6), ['pr', 'list', '--state', 'all', '--search', 'WP-7 in:title,body']);
});

test('GitHub pr-create·review·merge: gh 명령과 인자(머지는 --merge --match-head-commit)', () => {
  origin('https://github.com/a/wp.git');
  const body = join(root, 'body.md');
  writeFileSync(body, '개발: ai\n');
  reply({ 'gh pr create': { out: 'https://github.com/a/wp/pull/31\n' } });
  assert.deepEqual(JSON.parse(run(['pr-create', '--head', 'WP-1', '--title', 'WP-1 제목', '--body-file', body]).stdout), {
    number: 31,
    url: 'https://github.com/a/wp/pull/31',
  });
  assert.equal(run(['pr-review', '31', '--approve']).status, 0);
  assert.equal(run(['pr-review', '31', '--request-changes', '--body-file', body]).status, 0);
  assert.equal(run(['pr-merge', '31', '--sha', 'abc', '--subject', 'merge: WP-1 제목']).status, 0);
  assert.deepEqual(
    calls().map((c) => c.args),
    [
      ['pr', 'create', '--base', 'main', '--head', 'WP-1', '--title', 'WP-1 제목', '--body-file', body],
      ['pr', 'review', '31', '--approve'],
      ['pr', 'review', '31', '--request-changes', '--body-file', body],
      ['pr', 'merge', '31', '--merge', '--match-head-commit', 'abc', '--subject', 'merge: WP-1 제목'],
    ],
  );
});

test('pr-merge: 리뷰한 HEAD 없이는 머지하지 않는다(사용법 오류)', () => {
  origin('https://github.com/a/wp.git');
  assert.equal(run(['pr-merge', '31', '--subject', 'x']).status, 2);
  assert.equal(calls().length, 0);
});

const mr = (over = {}) => ({
  iid: 5, title: 'TTP-1 x', description: '개발: ai', web_url: 'https://gitlab.iacloud.kr/t/ttp/-/merge_requests/5', source_branch: 'TTP-1', sha: 'abc',
  state: 'opened', has_conflicts: false, detailed_merge_status: 'mergeable', head_pipeline: { status: 'failed' }, merge_commit_sha: null, ...over,
});

test('GitLab pr-view: MR·승인·리뷰어를 공통 모양으로, 경로는 %2F, 통계 끔', () => {
  origin('https://gitlab.iacloud.kr/t/sub/ttp.git');
  reply({
    'glab api --hostname gitlab.iacloud.kr projects/t%2Fsub%2Fttp/merge_requests/5/approvals': { out: { approved_by: [] } },
    'glab api --hostname gitlab.iacloud.kr projects/t%2Fsub%2Fttp/merge_requests/5/reviewers': { out: [{ state: 'requested_changes' }] },
    'glab api --hostname gitlab.iacloud.kr projects/t%2Fsub%2Fttp/merge_requests/5': { out: mr({ has_conflicts: true }) },
  });
  const r = run(['pr-view', '5']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), {
    number: 5, title: 'TTP-1 x', body: '개발: ai', url: 'https://gitlab.iacloud.kr/t/ttp/-/merge_requests/5', headRefName: 'TTP-1', headRefOid: 'abc',
    state: 'OPEN', mergeable: 'CONFLICTING', checks: 'FAIL', reviewDecision: 'CHANGES_REQUESTED', mergeCommit: null,
  });
  for (const c of calls()) {
    assert.equal(c.name, 'glab');
    assert.equal(c.telemetry, 'false');
    assert.equal(c.checkUpdate, 'false');
  }
});

test('GitLab pr-list: 열린 MR 만 단건으로 다시 보고, 머지된 것은 목록 값으로', () => {
  origin('git@gitlab.iacloud.kr:t/ttp.git');
  reply({
    'glab api --hostname gitlab.iacloud.kr projects/t%2Fttp/merge_requests?': {
      out: [mr(), mr({ iid: 6, state: 'merged', merge_commit_sha: 'm1', head_pipeline: undefined })],
    },
    'glab api --hostname gitlab.iacloud.kr projects/t%2Fttp/merge_requests/5/approvals': { out: { approved_by: [{ user: { username: 'lead' } }] } },
    'glab api --hostname gitlab.iacloud.kr projects/t%2Fttp/merge_requests/5/reviewers': { out: [] },
    'glab api --hostname gitlab.iacloud.kr projects/t%2Fttp/merge_requests/5': { out: mr({ head_pipeline: { status: 'running' } }) },
  });
  const r = run(['pr-list', '--all', '--search', 'TTP-1']);
  assert.equal(r.status, 0, r.stderr);
  const prs = JSON.parse(r.stdout);
  assert.deepEqual(prs.map((p) => [p.number, p.state, p.checks, p.reviewDecision, p.mergeCommit]), [
    [5, 'OPEN', 'PENDING', 'APPROVED', null],
    [6, 'MERGED', 'NONE', null, 'm1'],
  ]);
  assert.match(calls()[0].args[3], /state=all&per_page=100&search=TTP-1&in=title,description$/);
  assert.equal(calls().filter((c) => c.args[3].includes('/6')).length, 0);
});

test('GitLab pr-list --search: 이슈 키 아닌 값은 거절(쿼리 문자열에 그대로 붙이므로)', () => {
  origin('https://gitlab.iacloud.kr/t/ttp');
  assert.equal(run(['pr-list', '--search', 'a&b=c']).status, 2);
});

test('GitLab pr-create·review·merge: REST 호출과 본문(임시 파일은 남지 않는다)', () => {
  origin('https://gitlab.iacloud.kr/t/ttp.git');
  const body = join(root, 'body.md');
  writeFileSync(body, '개발: ai\n"따옴표"\n');
  reply({ 'glab api --hostname gitlab.iacloud.kr -X POST projects/t%2Fttp/merge_requests --input': { out: mr({ iid: 9, web_url: 'w9' }) } });
  assert.deepEqual(JSON.parse(run(['pr-create', '--head', 'TTP-1', '--title', 'TTP-1 제목', '--body-file', body]).stdout), { number: 9, url: 'w9' });
  assert.equal(run(['pr-review', '9', '--approve', '--sha', 'abc']).status, 0);
  assert.equal(run(['pr-review', '9', '--request-changes', '--body-file', body]).status, 0);
  assert.equal(run(['pr-merge', '9', '--sha', 'abc', '--subject', 'merge: TTP-1 제목']).status, 0);
  const cs = calls();
  assert.deepEqual(JSON.parse(cs[0].input), {
    source_branch: 'TTP-1', target_branch: 'main', title: 'TTP-1 제목', description: '개발: ai\n"따옴표"\n', remove_source_branch: false,
  });
  assert.deepEqual(cs[1].args.slice(3), ['-X', 'POST', 'projects/t%2Fttp/merge_requests/9/approve', '-f', 'sha=abc']);
  assert.equal(cs[2].args[5], 'projects/t%2Fttp/merge_requests/9/notes');
  assert.deepEqual(JSON.parse(cs[2].input), { body: '개발: ai\n"따옴표"\n' });
  assert.equal(cs[3].args[5], 'projects/t%2Fttp/merge_requests/9/unapprove');
  assert.deepEqual(cs[4].args.slice(3, 6), ['-X', 'PUT', 'projects/t%2Fttp/merge_requests/9/merge']);
  assert.deepEqual(JSON.parse(cs[4].input), { sha: 'abc', merge_commit_message: 'merge: TTP-1 제목', squash: false, should_remove_source_branch: false });
  assert.equal(spawnSync('sh', ['-c', `ls ${root} | grep -c gw-repo`], { encoding: 'utf8' }).stdout.trim(), '0');
});

test('GitLab: Pod 의 토큰 파일은 glab 을 부를 때 GITLAB_TOKEN 으로만 넘기고 인자에 넣지 않는다', () => {
  origin('https://gitlab.iacloud.kr/t/ttp.git');
  mkdirSync(join(runDir, 'repo-tokens', 'gitlab'), { recursive: true });
  writeFileSync(join(runDir, 'repo-tokens', 'gitlab', 'gitlab.iacloud.kr'), 'glpat-secret');
  reply({ 'glab api --hostname gitlab.iacloud.kr projects/t%2Fttp/merge_requests/5': { out: mr() } });
  run(['pr-view', '5']);
  for (const c of calls()) {
    assert.equal(c.token, 'glpat-secret');
    assert.ok(!c.args.join(' ').includes('glpat-secret'));
  }
  // 토큰 파일이 있으면 로그인 확인은 통과(glab auth 를 부르지 않는다).
  assert.equal(run(['auth-check']).status, 0);
});

test('GitLab 머지 거절(HEAD 가 다름 등)은 glab 의 실패를 그대로 돌려준다', () => {
  origin('https://gitlab.iacloud.kr/t/ttp.git');
  reply({ 'glab api --hostname gitlab.iacloud.kr -X PUT': { code: 1, err: 'glab: 409 SHA does not match HEAD of source branch' } });
  const r = run(['pr-merge', '5', '--sha', 'old', '--subject', 's']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /SHA does not match/);
});

test('auth-check: CLI 가 없으면 3, 로그인 안 됐으면 4', () => {
  origin('https://github.com/a/wp.git');
  reply({ 'gh auth status': { code: 1 } });
  const r = run(['auth-check']);
  assert.equal(r.status, 4);
  assert.match(r.stderr, /gh auth login --hostname github.com/);
  // 쓰는 계정만 본다 — 쓰지 않는 계정의 만료 토큰 때문에 멈추지 않게(--active).
  assert.ok(calls().some((c) => c.args.join(' ') === 'auth status --active --hostname github.com'), JSON.stringify(calls().map((c) => c.args)));
  // gh 없는 PATH — jq·git 은 진짜가 있어야 하므로 그 둘만 링크한 폴더를 쓴다.
  const only = join(root, 'only');
  mkdirSync(only);
  for (const n of ['jq', 'git', 'sh', 'cat', 'tr', 'sed', 'mktemp', 'rm']) {
    const p = spawnSync('sh', ['-c', `command -v ${n}`], { encoding: 'utf8' }).stdout.trim();
    if (p && !existsSync(join(only, n))) symlinkSync(p, join(only, n));
  }
  const r2 = run(['auth-check'], { path: only });
  assert.equal(r2.status, 3);
  assert.match(r2.stderr, /gh 가 없습니다/);
});

test('auth-check: 옛 gh 가 --active 를 모르면(unknown flag) --active 없이 한 번 더 본다', () => {
  origin('https://github.com/a/wp.git');
  reply({ 'gh auth status --active': { code: 1, err: 'unknown flag: --active' } });
  assert.equal(run(['auth-check']).status, 0);
  assert.ok(calls().some((c) => c.args.join(' ') === 'auth status --hostname github.com'), JSON.stringify(calls().map((c) => c.args)));
  // 옛 방식도 로그인이 안 돼 있으면 4.
  reply({ 'gh auth status --active': { code: 1, err: 'unknown flag: --active' }, 'gh auth status --hostname': { code: 1 } });
  assert.equal(run(['auth-check']).status, 4);
  // unknown flag 가 아닌 실패(진짜 로그인 안 됨)는 다시 보지 않는다.
  writeFileSync(log, '');
  reply({ 'gh auth status': { code: 1, err: 'You are not logged into any GitHub hosts' } });
  assert.equal(run(['auth-check']).status, 4);
  assert.equal(calls().filter((c) => c.args[0] === 'auth').length, 1);
});

test('리뷰 수정: 경로 대문자 허용, gh 실패는 실패로, 번호가 이상하면 아무것도 부르지 않는다', () => {
  origin('https://github.com/MyOrg/Repo.git');
  assert.equal(run(['kind']).stdout.trim(), 'github');
  reply({ 'gh pr list': { code: 1, err: 'HTTP 401: Bad credentials' }, 'gh pr view': { code: 1, err: 'no pull requests found' } });
  const r = run(['pr-list', '--all', '--search', 'WP-12']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Bad credentials/);
  assert.notEqual(run(['pr-view', '3']).status, 0);
  const before = calls().length;
  assert.equal(run(['pr-review', '#12', '--approve']).status, 2);
  assert.equal(run(['pr-merge', '', '--sha', 'a', '--subject', 's']).status, 2);
  assert.equal(calls().length, before);
});

test('리뷰 수정: GitLab need_rebase 는 충돌로, auth-check 는 토큰이 통하는지(GET user) 본다', () => {
  origin('https://gitlab.iacloud.kr/Team/TTP.git');
  reply({
    'glab api --hostname gitlab.iacloud.kr projects/Team%2FTTP/merge_requests/5/': { out: {} },
    'glab api --hostname gitlab.iacloud.kr projects/Team%2FTTP/merge_requests/5': { out: mr({ detailed_merge_status: 'need_rebase', has_conflicts: false }) },
    'glab api --hostname gitlab.iacloud.kr user': { code: 1, err: 'glab: 401 Unauthorized' },
  });
  assert.equal(JSON.parse(run(['pr-view', '5']).stdout).mergeable, 'CONFLICTING');
  const a = run(['auth-check']);
  assert.equal(a.status, 4);
  assert.match(a.stderr, /토큰이 통하지 않습니다/);
});

// WP-2143 deploy 스킬이 낼 커밋의 이미지 빌드 잡을 확인한다 — 두 호스트 같은 모양 {status, url}.
const SHA40 = 'f705a78781a832ceb150ed037adbf093085122ca';

test('ci-job GitLab: 최근 파이프라인부터 그 이름의 잡을 찾고, 재시도면 가장 최근 잡, 상태를 공통 값으로', () => {
  origin('https://gitlab.iacloud.kr/demo/factory-board.git');
  mkdirSync(join(runDir, 'repo-tokens', 'gitlab'), { recursive: true });
  writeFileSync(join(runDir, 'repo-tokens', 'gitlab', 'gitlab.iacloud.kr'), 'tok');
  reply({
    [`glab api --hostname gitlab.iacloud.kr projects/demo%2Ffactory-board/pipelines?sha=${SHA40}`]: { out: [{ id: 10 }, { id: 12 }] },
    // 최근(12) 파이프라인에는 그 잡이 없다 — 10 에서 찾는다.
    'glab api --hostname gitlab.iacloud.kr projects/demo%2Ffactory-board/pipelines/12/jobs': { out: [{ id: 5, name: 'test', status: 'success' }] },
    'glab api --hostname gitlab.iacloud.kr projects/demo%2Ffactory-board/pipelines/10/jobs': {
      out: [
        { id: 3, name: 'build-image', status: 'failed', web_url: 'u3' },
        { id: 4, name: 'build-image', status: 'success', web_url: 'u4' },
      ],
    },
  });
  const r = run(['ci-job', SHA40, 'build-image']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { status: 'PASS', url: 'u4' });
  const c = calls();
  assert.equal(c[0].args.at(-1), `projects/demo%2Ffactory-board/pipelines?sha=${SHA40}&per_page=20`);
  assert.equal(c[1].args.at(-1), 'projects/demo%2Ffactory-board/pipelines/12/jobs?per_page=100&include_retried=true');
  assert.ok(c.every((x) => x.token === 'tok' && x.telemetry === 'false'));

  reply({
    [`glab api --hostname gitlab.iacloud.kr projects/demo%2Ffactory-board/pipelines?sha=${SHA40}`]: { out: [{ id: 10 }] },
    'glab api --hostname gitlab.iacloud.kr projects/demo%2Ffactory-board/pipelines/10/jobs': { out: [{ id: 3, name: 'build-image', status: 'manual', web_url: 'u' }] },
  });
  assert.equal(JSON.parse(run(['ci-job', SHA40, 'build-image']).stdout).status, 'PENDING');
  reply({ [`glab api --hostname gitlab.iacloud.kr projects/demo%2Ffactory-board/pipelines?sha=${SHA40}`]: { out: [] } });
  assert.deepEqual(JSON.parse(run(['ci-job', SHA40, 'build-image']).stdout), { status: 'NONE', url: null });
});

test('ci-job GitHub: check-runs 에서 그 이름의 가장 최근 실행', () => {
  origin('https://github.com/a/wp.git');
  reply({
    [`gh api repos/a/wp/commits/${SHA40}/check-runs`]: {
      out: {
        check_runs: [
          { name: 'build', status: 'completed', conclusion: 'failure', started_at: '2026-11-26T01:00:00Z', html_url: 'old' },
          { name: 'build', status: 'in_progress', conclusion: null, started_at: '2026-11-26T02:00:00Z', html_url: 'new' },
          { name: 'lint', status: 'completed', conclusion: 'success', started_at: '2026-11-26T03:00:00Z', html_url: 'l' },
        ],
      },
    },
  });
  assert.deepEqual(JSON.parse(run(['ci-job', SHA40, 'build']).stdout), { status: 'PENDING', url: 'new' });
  assert.deepEqual(JSON.parse(run(['ci-job', SHA40, 'deploy']).stdout), { status: 'NONE', url: null });
});

test('ci-job: 40자 SHA 가 아니거나 잡 이름이 이상하면 아무것도 부르지 않고 종료 2', () => {
  origin('https://gitlab.iacloud.kr/demo/factory-board.git');
  assert.equal(run(['ci-job', 'f705a787', 'build-image']).status, 2);
  assert.equal(run(['ci-job', SHA40, 'a;rm -rf']).status, 2);
  assert.equal(run(['ci-job', SHA40]).status, 2);
  assert.deepEqual(calls(), []);
});

// Pod 의 GitHub 토큰 파일을 gh 호출에만 환경변수로 넘긴다(WP-2167) — gh 로그인 기록이 없어도 PR 흐름이 돈다.
function ghToken(host, value) {
  mkdirSync(join(runDir, 'repo-tokens', 'github'), { recursive: true });
  writeFileSync(join(runDir, 'repo-tokens', 'github', host), value);
}

test('GitHub Pod 토큰 파일이 있으면 gh 호출마다 GH_TOKEN 으로 넘기고 인자에는 두지 않는다', () => {
  origin('https://github.com/a/wp.git');
  ghToken('github.com', 'ghp-podsecret\n');
  reply({ 'gh pr view': { out: { number: 5, title: 't', body: '', url: 'u', headRefName: 'h', headRefOid: 'o', state: 'OPEN', mergeable: 'MERGEABLE', statusCheckRollup: [], reviewDecision: '', mergeCommit: null } } });
  assert.equal(run(['pr-view', '5']).status, 0);
  assert.equal(run(['auth-check']).status, 0);
  const c = calls();
  assert.ok(c.length >= 2);
  for (const x of c) {
    assert.equal(x.ghToken, 'ghp-podsecret');
    assert.equal(x.ghEnterpriseToken, null);
    assert.equal(x.ghHost, null); // github.com 호출에는 GH_HOST 를 넣지 않는다
    assert.ok(!JSON.stringify(x.args).includes('ghp-podsecret'));
  }
});

test('GitHub Enterprise 호스트는 GH_ENTERPRISE_TOKEN 으로', () => {
  origin('https://code.example.com/a/b.git');
  ghToken('code.example.com', 'ghe-secret');
  assert.equal(run(['auth-check']).status, 0);
  const c = calls();
  assert.ok(c.length >= 1);
  for (const x of c) {
    assert.equal(x.ghEnterpriseToken, 'ghe-secret');
    assert.equal(x.ghToken, null);
    assert.equal(x.ghHost, 'code.example.com'); // 로그인 기록 없이 gh 가 그 호스트를 알게
  }
});

test('GitHub Enterprise Cloud(*.ghe.com)는 GH_TOKEN 과 GH_HOST 로', () => {
  origin('https://acme.ghe.com/a/b.git');
  ghToken('acme.ghe.com', 'ghec-secret');
  assert.equal(run(['auth-check']).status, 0);
  const c = calls();
  assert.ok(c.length >= 1);
  for (const x of c) {
    assert.equal(x.ghToken, 'ghec-secret');
    assert.equal(x.ghEnterpriseToken, null);
    assert.equal(x.ghHost, 'acme.ghe.com');
  }
});

test('gh 통과: GitHub 은 Pod 토큰으로 gh 를 그대로 부르고, GitLab 은 2', () => {
  origin('https://github.com/a/wp.git');
  ghToken('github.com', 'ghp-podsecret');
  const r = run(['gh', 'run', 'list', '--branch', 'main', '--workflow', 'CI', '--limit', '5']);
  assert.equal(r.status, 0, r.stderr);
  const c = calls();
  assert.deepEqual(c.at(-1).args, ['run', 'list', '--branch', 'main', '--workflow', 'CI', '--limit', '5']);
  assert.equal(c.at(-1).ghToken, 'ghp-podsecret');
  assert.equal(run(['gh']).status, 2);
  spawnSync('git', ['remote', 'set-url', 'origin', 'https://gitlab.iacloud.kr/t/ttp.git'], { cwd: repo });
  const g = run(['gh', 'run', 'list']);
  assert.equal(g.status, 2);
  assert.match(g.stderr, /GitHub 저장소만/);
});

test('auth-check: Pod 토큰이 있는데 실패하면 토큰 거절로 안내한다', () => {
  origin('https://github.com/a/wp.git');
  ghToken('github.com', 'ghp-revoked');
  reply({ 'gh auth status': { code: 1, err: '  - The token in GH_TOKEN is invalid.\n  - Error: non-200 OK status code: 401 Unauthorized body: "Bad credentials"' } });
  const r = run(['auth-check']);
  assert.equal(r.status, 4);
  assert.match(r.stderr, /Pod 의 GitHub 토큰\(github.com\)이 거절됐습니다/);
  assert.match(r.stderr, /git-auth\.log/);
});

test('auth-check: 옛 gh(--active 없음)에서 Pod 토큰이 거절되면 다시 본 호출의 401 로 거절 안내', () => {
  origin('https://github.com/a/wp.git');
  ghToken('github.com', 'ghp-revoked');
  reply({ 'gh auth status --active': { code: 1, err: 'unknown flag: --active' }, 'gh auth status --hostname': { code: 1, err: '  - Error: non-200 OK status code: 401 Unauthorized body: "Bad credentials"' } });
  const r = run(['auth-check']);
  assert.equal(r.status, 4);
  assert.match(r.stderr, /거절됐습니다/);
});

test('auth-check: 오류에 숫자 401 이 섞인 연결 실패는 거절로 보지 않는다', () => {
  origin('https://github.com/a/wp.git');
  ghToken('github.com', 'ghp-ok');
  reply({ 'gh auth status': { code: 1, err: '  - Error: Post "https://api.github.com/graphql": dial tcp 10.140.1.5:4401: connection refused' } });
  const r = run(['auth-check']);
  assert.equal(r.status, 4);
  assert.doesNotMatch(r.stderr, /거절됐습니다/);
});

test('auth-check: Pod 토큰이 있어도 연결 실패는 거절로 안내하지 않고 gh 의 Error 줄을 보인다', () => {
  origin('https://github.com/a/wp.git');
  ghToken('github.com', 'ghp-ok');
  // gh 2.106.0 은 연결 실패도 「token … is invalid」로 적는다 — Error 줄로 가른다.
  reply({ 'gh auth status': { code: 1, err: '  X Failed to log in to github.com using token (GH_TOKEN)\n  - The token in GH_TOKEN is invalid.\n  - Error: Post "https://api.github.com/graphql": dial tcp: connection refused' } });
  const r = run(['auth-check']);
  assert.equal(r.status, 4);
  assert.doesNotMatch(r.stderr, /거절됐습니다/);
  assert.match(r.stderr, /확인하지 못했습니다/);
  assert.match(r.stderr, /Error: Post "https:\/\/api\.github\.com\/graphql": dial tcp: connection refused/);
});

test('토큰 파일 끝의 CR·줄바꿈·공백은 빼고 넘긴다', () => {
  origin('https://github.com/a/wp.git');
  ghToken('github.com', 'ghp-crlf \r\n');
  assert.equal(run(['auth-check']).status, 0);
  for (const x of calls()) assert.equal(x.ghToken, 'ghp-crlf');
});

test('빈 토큰 파일이면 토큰을 넘기지 않는다', () => {
  origin('https://github.com/a/wp.git');
  ghToken('github.com', '');
  assert.equal(run(['auth-check']).status, 0);
  for (const x of calls()) {
    assert.equal(x.ghToken, null);
    assert.equal(x.ghEnterpriseToken, null);
  }
});

test('세션에 GH_TOKEN 이 있어도 Pod 토큰 파일 값이 쓰인다', () => {
  origin('https://github.com/a/wp.git');
  ghToken('github.com', 'ghp-pod');
  assert.equal(run(['auth-check'], { env: { GH_TOKEN: 'old' } }).status, 0);
  for (const x of calls()) assert.equal(x.ghToken, 'ghp-pod');
});
