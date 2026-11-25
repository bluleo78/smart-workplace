// WP-1836 procedure-check 테스트 — 임시 git 저장소(MAIN)에 notes·계획 파일·원장을 만들고 cwd=MAIN 으로 스크립트를 돌려
// 「절차」 줄·계획 파일·SDD 원장 검사가 통과/실패/예외를 바르게 가르는지, 실패 문구와 종료 코드가 맞는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', 'scripts', 'procedure-check');

// 커밋 신원·전역 설정에 기대지 않게 git 환경을 고정한다.
const env = {
  PATH: process.env.PATH,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

/** 좋은 절차 줄 — 모든 필수 토큰과 계획 파일(docs/superpowers/plans/p.md)을 갖춘다. */
const GOOD =
  '절차: 처리 파일 process-issue.md (플러그인 0.1.69) → brainstorming(Skill) → writing-plans(Skill, docs/superpowers/plans/p.md) → ' +
  'subagent-driven-development(Skill, Task 2개 — 구현자·과제 검토자 하위 에이전트, 모델 sonnet) → 최종 리뷰 → /code-review medium(지적 0) → /simplify';
const LEDGER = '원장:\nTask 1: complete (commits a..b, review clean)\nTask 2: complete (commits b..c, review clean)\n최종 리뷰: clean\n';

/** 임시 MAIN(git 저장소) — notes 폴더와 WP-1 이슈 워크트리 폴더를 만들어 둔다. */
function repo(t) {
  const root = mkdtempSync(join(tmpdir(), 'gw-proc-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const main = join(root, 'main');
  mkdirSync(main);
  const r = spawnSync('git', ['init', '-q', '-b', 'main', main], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  mkdirSync(join(main, '.work-loop/state/notes'), { recursive: true });
  mkdirSync(join(main, '.claude/worktrees/WP-1'), { recursive: true });
  return main;
}

// 1번 「시작」이 적는 처리 파일 줄 — 버전이 있어 전환(버전 없음)으로 빠지지 않는 notes 머리(WP-1836 리뷰 후속).
const NOTES_HEAD = '처리 파일: process-issue.md (플러그인 0.1.69) 읽음 10:00\n';
function notes(main, body, key = 'WP-1') {
  writeFileSync(join(main, '.work-loop/state/notes', `${key}.md`), body);
}

function plan(dir) {
  mkdirSync(join(dir, 'docs/superpowers/plans'), { recursive: true });
  writeFileSync(join(dir, 'docs/superpowers/plans/p.md'), '# plan\n');
}

function run(main, arg = 'WP-1') {
  return spawnSync(script, [arg], { cwd: main, encoding: 'utf8', env });
}

function ok(r) {
  assert.equal(r.status, 0, r.stdout + r.stderr);
}

function fail(r, text) {
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes(text), `기대 문구 없음: ${text}\n${r.stdout}`);
}

test('통과 — 워크트리 계획 파일 + notes 원장 절(원장 파일 없이)', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD}\n\n${LEDGER}`);
  const r = run(main);
  ok(r);
  assert.ok(r.stdout.includes('[procedure-check] WP-1: 통과'));
});

test('통과 — 목록 기호 절차 줄·원장 줄', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `- ${GOOD}\n\n- 원장:\n- Task 1: complete (x)\n- Task 2: complete (y)\n- 최종 리뷰: clean\n`);
  ok(run(main));
});

test('통과 — 워크스페이스 progress.md 원장', (t) => {
  const main = repo(t);
  const wt = join(main, '.claude/worktrees/WP-1');
  plan(wt);
  mkdirSync(join(wt, '.superpowers/sdd/p'), { recursive: true });
  writeFileSync(join(wt, '.superpowers/sdd/p/progress.md'),
    '# SDD ledger — plan: docs/superpowers/plans/p.md\n- Task 1: complete (a)\n- Task 2: complete (b)\nFinal review: clean\n');
  notes(main, `${GOOD}\n`);
  ok(run(main));
});

test('실패 — 절차 줄 없음', (t) => {
  const main = repo(t);
  notes(main, NOTES_HEAD);
  fail(run(main), '절차: 줄이 없습니다');
});

test('실패 — 자리 표시가 남음', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD.replace('Task 2개', 'Task <n>개')}\n\n${LEDGER}`);
  const r = run(main);
  fail(r, '자리 표시가 남아 있습니다: <n>');
  assert.ok(r.stdout.includes('실패 — process-issue.md 5번부터 다시 밟습니다'));
});

test('실패 — 공백 든 자리 표시 <계획 파일>', (t) => {
  const main = repo(t);
  notes(main, `${GOOD.replace('docs/superpowers/plans/p.md', '<계획 파일>')}\n`);
  fail(run(main), '자리 표시가 남아 있습니다: <계획 파일>');
});

test('실패 — brainstorming 빠짐', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD.replace('brainstorming(Skill) → ', '')}\n\n${LEDGER}`);
  fail(run(main), 'brainstorming(Skill)');
});

test('실패 — 원장에 Task 2 없음', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD}\n\n원장:\nTask 1: complete (a)\n최종 리뷰: clean\n`);
  fail(run(main), 'Task 2 완료 줄이 없습니다');
});

test('실패 — 최종 리뷰 줄 없음', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD}\n\n원장:\nTask 1: complete (a)\nTask 2: complete (b)\n`);
  fail(run(main), '최종 리뷰 결과가 없습니다');
});

test('실패 — 원장 없음', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD}\n`);
  fail(run(main), 'SDD 원장이 없습니다');
});

test('실패 — 계획 파일 없음(notes 원장 절도 없음)', (t) => {
  const main = repo(t);
  notes(main, `${GOOD}\n`);
  fail(run(main), '계획 파일이 없습니다: docs/superpowers/plans/p.md');
});

test('통과 — 상대경로 계획 파일을 MAIN 에서 찾음', (t) => {
  const main = repo(t);
  plan(main);
  notes(main, `${GOOD}\n\n${LEDGER}`);
  ok(run(main));
});

test('예외 — 리뷰 후속', (t) => {
  const main = repo(t);
  notes(main, '리뷰 후속: 1490\n브랜치: fix/wp-1-2\n마지막 완료 단계: 리뷰 후속 수정\n');
  const r = run(main);
  ok(r);
  assert.ok(r.stdout.includes('통과(리뷰 후속 수정 — 앞 PR 의 절차를 씀)'));
});

test('예외 — executing-plans 와 까닭', (t) => {
  const main = repo(t);
  notes(main, '절차: 처리 파일 process-issue.md (플러그인 0.1.69) → executing-plans(까닭: 하위 에이전트 도구 없음) → 최종 리뷰 → /code-review medium(지적 0) → /simplify\n');
  ok(run(main));
});

test('전환 — 플러그인 0.1.50 은 계획 파일·원장을 보지 않음', (t) => {
  const main = repo(t);
  notes(main, `${GOOD.replace('0.1.69', '0.1.50')}\n`);
  ok(run(main));
});

test('notes 없음 → 2', (t) => {
  const main = repo(t);
  const r = run(main, 'WP-9');
  assert.equal(r.status, 2);
  assert.ok(r.stdout.includes('notes 파일이 없습니다'));
});

test('notes 경로 인자 → 키 WP-1', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD}\n\n${LEDGER}`);
  const r = run(main, join(main, '.work-loop/state/notes/WP-1.md'));
  ok(r);
  assert.ok(r.stdout.includes('WP-1: 통과'));
});

// ---- 최종 리뷰 수정 묶음(WP-1836) ----

const TAIL_NOTES = '실패 — notes 의 원장 절을 고칩니다(원장 줄이 남아 있으면 옮겨 적기)';
const TAIL_STEPS = '실패 — process-issue.md 5번부터 다시 밟습니다';

test('전환 — 0.1.67 + 원장 없음 → 0 과 참고 줄', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD.replace('0.1.69', '0.1.67')}\n`);
  const r = run(main);
  ok(r);
  assert.ok(r.stdout.includes('[procedure-check] WP-1: 참고 — 0.1.69 전 절차라 notes 원장 절이 없음, 원장 줄은 PR 본문으로 검토자가 본다'), r.stdout);
});

test('전환 — 0.1.69 + 원장 없음 → 1', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD}\n`);
  fail(run(main), 'SDD 원장이 없습니다');
});

test('전환 — 0.1.55 경계: 0.1.54 는 계획·원장 생략, 0.1.55 + 원장 없음은 참고', (t) => {
  const main = repo(t);
  notes(main, `${GOOD.replace('0.1.69', '0.1.54')}\n`);
  ok(run(main));
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD.replace('0.1.69', '0.1.55')}\n`);
  const r = run(main);
  ok(r);
  assert.ok(r.stdout.includes('참고'), r.stdout);
});

test('전환 — 0.1.67 + 계획 파일 없음은 여전히 실패', (t) => {
  const main = repo(t);
  notes(main, `${GOOD.replace('0.1.69', '0.1.67')}\n`);
  fail(run(main), '계획 파일이 없습니다');
});

test('전환 — 0.1.67 + 원장 있으면 검사한다', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD.replace('0.1.69', '0.1.67')}\n\n원장:\nTask 1: complete (a)\n`);
  fail(run(main), 'Task 2 완료 줄이 없습니다');
});

test('전환 — 버전 없음 → 0', (t) => {
  const main = repo(t);
  notes(main, `${GOOD.replace(' (플러그인 0.1.69)', '')}\n`);
  ok(run(main));
});

test('원장 절 — 머리 뒤 빈 줄을 건너뜀', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD}\n\n원장:\n\nTask 1: complete (a)\nTask 2: complete (b)\n최종 리뷰: clean\n`);
  ok(run(main));
});

test('원장 절 — ## 원장 머리', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD}\n\n## 원장 (SDD)\nTask 1: complete (a)\nTask 2: complete (b)\n최종 리뷰: clean\n\n## 다음\n`);
  ok(run(main));
});

test('원장 절 — 내용 뒤 빈 줄에서 끝남', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD}\n\n원장:\nTask 1: complete (a)\n\nTask 2: complete (b)\n최종 리뷰: clean\n`);
  fail(run(main), 'Task 2 완료 줄이 없습니다');
});

test('끝 문구 — 원장 항목뿐이면 notes 원장 절 안내', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD}\n\n원장:\nTask 1: complete (a)\n최종 리뷰: clean\n`);
  const r = run(main);
  fail(r, TAIL_NOTES);
  assert.ok(!r.stdout.includes(TAIL_STEPS));
});

test('끝 문구 — 계획 파일 없음도 notes 안내', (t) => {
  const main = repo(t);
  notes(main, `${GOOD}\n`);
  fail(run(main), TAIL_NOTES);
});

test('끝 문구 — 절차 줄 토큰 빠짐이 섞이면 5번부터', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD.replace('brainstorming(Skill) → ', '')}\n\nTask 1: complete\n`);
  const r = run(main);
  fail(r, TAIL_STEPS);
  assert.ok(!r.stdout.includes(TAIL_NOTES));
});

test('SDD 괄호 안에 괄호가 있어도 모델을 찾음', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD.replace('Task 2개 — 구현자', 'Task 2개(T1·T2) — 구현자')}\n\n${LEDGER}`);
  ok(run(main));
});

test('실패 — SDD 구간에 모델 없음', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD.replace(', 모델 sonnet', '')}\n\n${LEDGER}`);
  fail(run(main), 'subagent-driven-development 괄호 안에 모델 이름이 없습니다');
});

test('실패 — 최종 리뷰가 진행 중이면 결과 없음', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD}\n\n원장:\nTask 1: complete (a)\nTask 2: complete (b)\n최종 리뷰: 진행 중\n`);
  fail(run(main), '원장에 최종 리뷰 결과가 없습니다');
  notes(main, `${GOOD}\n\n원장:\nTask 1: complete (a)\nTask 2: complete (b)\nFinal review: In Progress\n`);
  fail(run(main), '원장에 최종 리뷰 결과가 없습니다');
});

test('세부 실패 줄에도 [procedure-check] 키 접두', (t) => {
  const main = repo(t);
  notes(main, `${GOOD}\n`);
  fail(run(main), '[procedure-check] WP-1: 계획 파일이 없습니다');
  notes(main, NOTES_HEAD);
  fail(run(main), '[procedure-check] WP-1: 절차: 줄이 없습니다');
});

test('까닭 대안 줄에 자리 표시가 남으면 자리 표시 실패만', (t) => {
  const main = repo(t);
  notes(main, '절차: 처리 파일 process-issue.md (플러그인 0.1.69) → executing-plans(까닭: <까닭>) → /simplify\n');
  const r = run(main);
  fail(r, '자리 표시가 남아 있습니다: <까닭>');
  assert.ok(!r.stdout.includes('brainstorming'), r.stdout);
});

test('예외 — without-superpowers.md 와 까닭 → 0', (t) => {
  const main = repo(t);
  notes(main, '절차: 처리 파일 without-superpowers.md (플러그인 0.1.69) → 까닭: 스킬 도구 없는 실행기 → /code-review medium(지적 0) → /simplify\n');
  ok(run(main));
});

test('실패 — executing-plans 인데 까닭 없음', (t) => {
  const main = repo(t);
  notes(main, '절차: 처리 파일 process-issue.md (플러그인 0.1.69) → executing-plans → /code-review medium(지적 0) → /simplify\n');
  fail(run(main), 'brainstorming(Skill)');
});

test('예외 — 리뷰 후속 수정 — 앞 PR #12 문구', (t) => {
  const main = repo(t);
  notes(main, '이것저것\n리뷰 후속 수정 — 앞 PR #12\n');
  ok(run(main));
});

test('원장 — basename 이 다른 progress.md 만 있으면 원장 없음', (t) => {
  const main = repo(t);
  const wt = join(main, '.claude/worktrees/WP-1');
  plan(wt);
  mkdirSync(join(wt, '.superpowers/sdd/q'), { recursive: true });
  writeFileSync(join(wt, '.superpowers/sdd/q/progress.md'),
    '# SDD ledger — plan: docs/superpowers/plans/other.md\n- Task 1: complete (a)\n- Task 2: complete (b)\nFinal review: clean\n');
  notes(main, `${GOOD}\n`);
  fail(run(main), 'SDD 원장이 없습니다');
});

test('원장 합침 — progress.md 에 Task 줄만, notes 원장: 절에 최종 리뷰', (t) => {
  const main = repo(t);
  const wt = join(main, '.claude/worktrees/WP-1');
  plan(wt);
  mkdirSync(join(wt, '.superpowers/sdd/p'), { recursive: true });
  writeFileSync(join(wt, '.superpowers/sdd/p/progress.md'),
    '# SDD ledger — plan: docs/superpowers/plans/p.md\n- Task 1: complete (a)\n- Task 2: complete (b)\n');
  notes(main, `${GOOD}\n\n원장:\n최종 리뷰: clean\n`);
  ok(run(main));
});

test('원장 합침 — Task 줄이 notes 에만 있어도 인정', (t) => {
  const main = repo(t);
  const wt = join(main, '.claude/worktrees/WP-1');
  plan(wt);
  mkdirSync(join(wt, '.superpowers/sdd/p'), { recursive: true });
  writeFileSync(join(wt, '.superpowers/sdd/p/progress.md'),
    '# SDD ledger — plan: docs/superpowers/plans/p.md\n- Task 1: complete (a)\n');
  notes(main, `${GOOD}\n\n${LEDGER}`);
  ok(run(main));
});

test('리뷰 후속 — 리뷰 후속: 줄이면 마지막 완료 단계와 상관없이 예외(쌓은 뒤 출발 검사에서도)', (t) => {
  const main = repo(t);
  notes(main, '리뷰 후속: 12\n브랜치: fix/wp-1-2\n마지막 완료 단계: 리뷰 후속 수정\n');
  ok(run(main));
  notes(main, '리뷰 후속: 12\n브랜치: fix/wp-1-2\n마지막 완료 단계: 백그라운드: 기차 게이트(integ/a-1)\n');
  ok(run(main));
  notes(main, '- 리뷰 후속: #12\n- 브랜치: fix/wp-1-3\n마지막 완료 단계: 기차에 쌓음\n');
  ok(run(main));
});
test('리뷰 후속 — 리뷰 후속 브랜치(-N)가 아니거나 앞 PR 번호가 없으면 예외 아님', (t) => {
  const main = repo(t);
  notes(main, NOTES_HEAD + '리뷰 후속: 12\n브랜치: fix/wp-1\n');
  fail(run(main), '절차: 줄이 없습니다');
  notes(main, NOTES_HEAD + '리뷰 후속: 없음\n브랜치: fix/wp-1-2\n');
  fail(run(main), '절차: 줄이 없습니다');
});

test('실패 — 모델 뒤에 이름이 없음', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD.replace(', 모델 sonnet', ', 모델')}\n\n${LEDGER}`);
  fail(run(main), '모델');
  notes(main, `${GOOD.replace(', 모델 sonnet', ', 모델:')}\n\n${LEDGER}`);
  fail(run(main), '모델');
});

test('실패 — 최종 리뷰 줄에 결과가 비어 있음', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD}\n\n원장:\nTask 1: complete (a)\nTask 2: complete (b)\n최종 리뷰:\n`);
  fail(run(main), '원장에 최종 리뷰 결과가 없습니다');
});

test('여러 절차: 줄이면 마지막 줄을 씀', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `절차: 처리 파일 process-issue.md (플러그인 <버전>)\n${GOOD}\n\n${LEDGER}`);
  ok(run(main));
});

test('버전 앞자리 0 — 0.1.08 은 0.1.8 로 다뤄 전환 규칙대로 통과', (t) => {
  const main = repo(t);
  notes(main, `${GOOD.replace('0.1.69', '0.1.08')}\n`);
  ok(run(main));
});

// ── 반려(PR #1508) 뒤 고친 것 ──
test('계획 파일이 없어도 notes 원장 절이 있으면 참고로 통과(워크트리를 다시 만든 경우)', (t) => {
  const main = repo(t);
  notes(main, `${GOOD}\n\n${LEDGER}`);
  const r = run(main);
  ok(r);
  assert.ok(r.stdout.includes('참고 — 계획 파일이 없음'), r.stdout);
});
test('대안 — executing-plans 도 /code-review·/simplify·최종 리뷰를 요구', (t) => {
  const main = repo(t);
  notes(main, '절차: 처리 파일 process-issue.md (플러그인 0.1.69) → executing-plans(까닭: 하위 에이전트 도구 없음) → /simplify\n');
  const r = run(main);
  fail(r, '코드 리뷰(/code-review 또는 requesting-code-review) 가 절차 줄에 없습니다');
  fail(r, '최종 리뷰 가 절차 줄에 없습니다');
});
test('대안 — without-superpowers.md 도 리뷰를 요구', (t) => {
  const main = repo(t);
  notes(main, '절차: 처리 파일 without-superpowers.md (플러그인 0.1.69) → 까닭: 스킬 도구 없는 실행기\n');
  fail(run(main), '정리(/simplify 또는 code-simplifier) 가 절차 줄에 없습니다');
});
test('전환 — 0.1.69 전 템플릿은 `모델` 한 낱말로 통과', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD.replace('0.1.69', '0.1.64').replace('모델 sonnet', '모델')}\n\n${LEDGER}`);
  ok(run(main));
});
test('전환 — 0.1.55 전이면 새 토큰이 없어도 통과', (t) => {
  const main = repo(t);
  notes(main, '절차: 처리 파일 process-issue.md (플러그인 0.1.50) → 직접 TDD\n');
  ok(run(main));
});
test('버전 — 절차 줄에 없으면 처리 파일: 줄에서 읽어 원장을 검사', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `처리 파일: process-issue.md (플러그인 0.1.69) 읽음 10:00\n${GOOD.replace(' (플러그인 0.1.69)', '')}\n`);
  fail(run(main), 'SDD 원장이 없습니다');
});
test('버전 — 처리 파일: 줄이 0.1.55 전이면 절차 줄이 없어도 통과', (t) => {
  const main = repo(t);
  notes(main, '처리 파일: process-issue.md (플러그인 0.1.40) 읽음 10:00\n');
  ok(run(main));
});
test('원장 — 여러 원장 절이면 마지막 절을 읽는다', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD}\n\n원장:\nTask 1: complete (old)\n\n${LEDGER}`);
  ok(run(main));
  notes(main, `${GOOD}\n\n${LEDGER}\n원장:\nTask 1: complete (new)\n`);
  fail(run(main), '원장에 Task 2 완료 줄이 없습니다');
});
test('원장 — 들여쓴 목록 줄도 읽는다', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD}\n\n원장:\n  - Task 1: complete (a)\n  - Task 2: complete (b)\n  - 최종 리뷰: clean\n`);
  ok(run(main));
});
test('자리 표시 — 템플릿 칸 이름만 잡고 Map<string> 같은 글은 통과', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD.replace('/simplify', '/simplify(Map<string> 정리)')}\n\n${LEDGER}`);
  ok(run(main));
  notes(main, `${GOOD.replace('Task 2개', 'Task <n>개')}\n\n${LEDGER}`);
  fail(run(main), '자리 표시가 남아 있습니다: <n>');
});

// ── /code-review(반려 수정) 뒤 고친 것 ──
test('대안 — 도구가 없어 자체 리뷰로 적으면 리뷰 단계 통과', (t) => {
  const main = repo(t);
  notes(main, '절차: 처리 파일 without-superpowers.md (플러그인 0.1.71) → 까닭: 스킬 도구 없는 실행기 → 자체 리뷰(까닭: /code-review·/simplify·대안 스킬 없음 — 정확성·단순화)\n');
  ok(run(main));
});
// WP-1836 리뷰 후속 — 까닭 없는 「자체 리뷰」(without-superpowers.md 4단계 이름)는 6번 리뷰로 치지 않는다.
test('대안 — 까닭 없는 자체 리뷰만 있고 6번 리뷰가 없으면 실패', (t) => {
  const main = repo(t);
  notes(main, '절차: 처리 파일 without-superpowers.md (플러그인 0.1.71) → 까닭: 스킬 도구 없는 실행기 → 자체 리뷰\n');
  fail(run(main), '코드 리뷰(/code-review 또는 requesting-code-review) 가 절차 줄에 없습니다');
});
// WP-1836 리뷰 후속 — 0.1.71 전에 적은 줄은 맨 「자체 리뷰」도 받는다(이미 낸 0.1.69·0.1.70 규칙).
test('전환 — 0.1.70 로 적은 맨 자체 리뷰는 통과', (t) => {
  const main = repo(t);
  notes(main, '절차: 처리 파일 without-superpowers.md (플러그인 0.1.70) → 까닭: 스킬 도구 없는 실행기 → 자체 리뷰(정확성·단순화)\n');
  ok(run(main));
});
// WP-1836 리뷰 후속 — 절차 줄도 버전도 없으면 검토자 전환 규칙대로 통과.
test('전환 — 절차 줄도 플러그인 버전도 없으면 통과', (t) => {
  const main = repo(t);
  notes(main, '아무 내용\n');
  const r = run(main);
  ok(r);
  assert.ok(r.stdout.includes('통과(전환 — 플러그인 버전 없음)'), r.stdout);
});
test('전환 — 0.1.55 전이어도 자리 표시는 잡는다', (t) => {
  const main = repo(t);
  notes(main, '처리 파일: process-issue.md (플러그인 0.1.40)\n절차: 처리 파일 <파일> (플러그인 <버전>) → 직접 TDD\n');
  fail(run(main), '자리 표시가 남아 있습니다: <버전>');
});
test('전환 — 버전이 어디에도 없으면 형식 토큰을 요구하지 않는다', (t) => {
  const main = repo(t);
  notes(main, '절차: brainstorming → 직접 TDD\n');
  const r = run(main);
  ok(r);
  assert.ok(r.stdout.includes('통과(전환 — 플러그인 버전 없음)'), r.stdout);
});
test('원장 — `원장:` 뒤에 글이 있는 줄은 머리로 보지 않는다', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD}\n\n${LEDGER}\n- 원장: progress.md 지움\n`);
  ok(run(main));
});
test('원장 — 들여쓴 ## 원장 머리도 읽는다', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD}\n\n  ## 원장\nTask 1: complete (a)\nTask 2: complete (b)\n최종 리뷰: clean\n`);
  ok(run(main));
});

// WP-1997 — 다른 이슈를 인용한 문구로는 예외가 되지 않는다.
test('예외 아님 — 다른 이슈의 리뷰 후속 문구를 prose 에 인용', (t) => {
  const main = repo(t);
  notes(main, NOTES_HEAD + 'PR 본문에 넣을 것(기차 28): WP-1958 절 「리뷰 후속 수정 — 앞 PR #1623」·②③·①\n');
  fail(run(main), '절차: 줄이 없습니다');
});
test('예외 아님 — 목록 기호로 감싼 인용', (t) => {
  const main = repo(t);
  notes(main, NOTES_HEAD + '- WP-1958 절 「리뷰 후속 수정 — 앞 PR #1623」\n');
  fail(run(main), '절차: 줄이 없습니다');
});
test('예외 아님 — 줄머리 선언인데 다른 이슈 키가 함께 있는 줄', (t) => {
  const main = repo(t);
  notes(main, NOTES_HEAD + '리뷰 후속 수정 — 앞 PR #1623 (WP-1958 인용)\n');
  fail(run(main), '절차: 줄이 없습니다');
});
test('예외 아님 — 같은 줄에 자기 키와 다른 이슈 키가 함께 있는 선언', (t) => {
  const main = repo(t);
  notes(main, NOTES_HEAD + '리뷰 후속 수정 — 앞 PR #1623 (WP-1 · WP-1958 인용)\n');
  fail(run(main), '절차: 줄이 없습니다');
});

// WP-1997 — 진짜 리뷰 후속 선언은 그대로 예외로 통과한다.
test('예외 — 자기 선언 줄(자기 키 없음)', (t) => {
  const main = repo(t);
  notes(main, NOTES_HEAD + '리뷰 후속 수정 — 앞 PR #1623\n');
  const r = run(main);
  ok(r);
  assert.ok(r.stdout.includes('통과(리뷰 후속 수정 — 앞 PR 의 절차를 씀)'));
});
test('예외 — 자기 선언 줄(같은 줄에 자기 이슈 키)', (t) => {
  const main = repo(t);
  notes(main, NOTES_HEAD + '리뷰 후속 수정 — 앞 PR #1623 (WP-1 선언)\n');
  const r = run(main);
  ok(r);
  assert.ok(r.stdout.includes('통과(리뷰 후속 수정 — 앞 PR 의 절차를 씀)'));
});

// WP-1997 리뷰 후속 ① — 이슈 키는 프로젝트 접두어 + 숫자만 키로 본다(UTF-8 같은 낱말 제외).
test('예외 — UTF-8·SDD-2 같은 낱말은 이슈 키가 아니다', (t) => {
  const main = repo(t);
  notes(main, NOTES_HEAD + '리뷰 후속 수정 — 앞 PR #1623 (UTF-8 · SDD-2 확인)\n');
  const r = run(main);
  ok(r);
  assert.ok(r.stdout.includes('통과(리뷰 후속 수정 — 앞 PR 의 절차를 씀)'));
});
test('예외 — 자기 프로젝트 접두어가 아닌 토큰(EIS-291)은 키 판정 범위 밖', (t) => {
  const main = repo(t);
  notes(main, NOTES_HEAD + '리뷰 후속 수정 — 앞 PR #1623 (EIS-291 인용)\n');
  const r = run(main);
  ok(r);
  assert.ok(r.stdout.includes('통과(리뷰 후속 수정 — 앞 PR 의 절차를 씀)'));
});

// WP-1997 리뷰 후속 ② — 머리에 다른 이슈 키가 있는 여러 줄 인용도 예외가 되지 않는다.
test('예외 아님 — 윗줄 머리에 다른 이슈 키가 있는 여러 줄 인용', (t) => {
  const main = repo(t);
  notes(main, NOTES_HEAD + '### WP-1958 절\n리뷰 후속 수정 — 앞 PR #1623\n');
  fail(run(main), '절차: 줄이 없습니다');
});
test('예외 아님 — 두 줄 위에 다른 이슈 키가 있고 그 뒤 줄에 키가 없는 인용', (t) => {
  const main = repo(t);
  notes(main, NOTES_HEAD + 'WP-1958 요약\n무언가 설명 줄\n리뷰 후속 수정 — 앞 PR #1623\n');
  fail(run(main), '절차: 줄이 없습니다');
});
test('예외 아님 — 빈 줄로 떨어져도 위 문단 머리에 다른 이슈 키가 있으면 인용', (t) => {
  const main = repo(t);
  notes(main, NOTES_HEAD + '### WP-1958 절\n\n리뷰 후속 수정 — 앞 PR #1623\n');
  fail(run(main), '절차: 줄이 없습니다');
});
test('예외 아님 — 목록 기호 선언인데 위 줄에 다른 이슈 키', (t) => {
  const main = repo(t);
  notes(main, NOTES_HEAD + 'WP-1958 정리\n- 리뷰 후속 수정 — 앞 PR #1623\n');
  fail(run(main), '절차: 줄이 없습니다');
});
test('예외 — 위 문단에 다른 이슈 키가 없고 빈 줄로 떨어진 선언', (t) => {
  const main = repo(t);
  notes(main, NOTES_HEAD + '앞 PR 메모\n\n리뷰 후속 수정 — 앞 PR #1623\n');
  const r = run(main);
  ok(r);
  assert.ok(r.stdout.includes('통과(리뷰 후속 수정 — 앞 PR 의 절차를 씀)'));
});
test('예외 — 진짜 선언 뒤에 인용 선언이 와도 앞의 진짜 선언으로 통과', (t) => {
  const main = repo(t);
  notes(main, NOTES_HEAD + '리뷰 후속 수정 — 앞 PR #1623\n리뷰 후속 수정 — 앞 PR #1623 (WP-1958 인용)\n');
  const r = run(main);
  ok(r);
  assert.ok(r.stdout.includes('통과(리뷰 후속 수정 — 앞 PR 의 절차를 씀)'));
});
test('예외 아님 — notes 경로 인자로 키 형식을 못 얻으면 첫 갈래를 쓰지 않는다', (t) => {
  const main = repo(t);
  notes(main, NOTES_HEAD + '### WP-1958 절\n리뷰 후속 수정 — 앞 PR #1623\n', 'not-a-key');
  const p = join(main, '.work-loop/state/notes/not-a-key.md');
  const r = spawnSync(script, [p], { cwd: main, encoding: 'utf8', env });
  fail(r, '절차: 줄이 없습니다');
});
test('예외 — 윗줄에 자기 키만 있는 줄은 인용이 아니다', (t) => {
  const main = repo(t);
  notes(main, NOTES_HEAD + 'WP-1 자기 정리\n리뷰 후속 수정 — 앞 PR #1623\n');
  const r = run(main);
  ok(r);
  assert.ok(r.stdout.includes('통과(리뷰 후속 수정 — 앞 PR 의 절차를 씀)'));
});

// WP-1993 처리 파일이 워크플로우 정의(.yaml)면 실패 안내는 5번부터가 아니라 개발 노드의 단계 되돌리기다.
const YAML_HEAD = '처리 파일: ai-dev-flow.yaml (플러그인 0.1.78) 읽음 10:00\n';
test('처리 파일이 워크플로우 정의(.yaml)면 실패 안내가 개발 노드 단계 되돌리기다', (t) => {
  const main = repo(t);
  notes(main, YAML_HEAD);
  const r = run(main);
  assert.equal(r.status, 1, r.stdout);
  assert.ok(r.stdout.includes('단계 되돌리기'), r.stdout);
  assert.ok(!r.stdout.includes('process-issue.md 5번부터'), r.stdout);
});
test('처리 파일이 .yaml 이어도 좋은 절차 줄·원장이면 통과', (t) => {
  const main = repo(t);
  plan(main);
  notes(main, YAML_HEAD + GOOD + '\n' + LEDGER);
  ok(run(main));
});
test('처리 파일이 .yaml 이고 원장 서식만 틀리면 끝줄은 기존 원장 절 안내 그대로', (t) => {
  const main = repo(t);
  plan(main);
  // 절차 줄은 좋고 원장 Task 2 줄이 빠진 경우 — 5번부터·단계 되돌리기가 아니라 원장 절만 고친다.
  notes(main, YAML_HEAD + GOOD + '\n원장:\nTask 1: complete (commits a..b, review clean)\n최종 리뷰: clean\n');
  const r = run(main);
  assert.equal(r.status, 1, r.stdout);
  assert.ok(r.stdout.includes('notes 의 원장 절을 고칩니다(원장 줄이 남아 있으면 옮겨 적기)'), r.stdout);
  assert.ok(!r.stdout.includes('단계 되돌리기'), r.stdout);
});
test('처리 파일이 .yaml 에서 md 로 바뀌면 마지막 줄 기준으로 5번부터 안내', (t) => {
  const main = repo(t);
  notes(main, YAML_HEAD + NOTES_HEAD);
  const r = run(main);
  assert.equal(r.status, 1, r.stdout);
  assert.ok(r.stdout.includes('process-issue.md 5번부터'), r.stdout);
  assert.ok(!r.stdout.includes('단계 되돌리기'), r.stdout);
});
test('처리 파일 줄이 없어도 절차 줄의 처리 파일이 .yaml 이면 단계 되돌리기 안내', (t) => {
  const main = repo(t);
  notes(main, '절차: 처리 파일 ai-dev-flow.yaml (플러그인 0.1.78) → brainstorming(Skill)\n');
  const r = run(main);
  assert.equal(r.status, 1, r.stdout);
  assert.ok(r.stdout.includes('단계 되돌리기'), r.stdout);
});
test('처리 파일 토큰이 백틱으로 감싸인 .yaml 이어도 워크플로우로 본다', (t) => {
  const main = repo(t);
  notes(main, '처리 파일: `ai-dev-flow.yaml` (플러그인 0.1.78) 읽음 10:00\n');
  const r = run(main);
  assert.equal(r.status, 1, r.stdout);
  assert.ok(r.stdout.includes('단계 되돌리기'), r.stdout);
});
test('처리 파일이 md 인 줄이 설명으로 yaml 을 언급해도 5번부터 안내', (t) => {
  const main = repo(t);
  notes(main, '처리 파일: process-issue.md (플러그인 0.1.78) 읽음 10:00 — ai-dev-flow.yaml 아님\n');
  const r = run(main);
  assert.equal(r.status, 1, r.stdout);
  assert.ok(r.stdout.includes('process-issue.md 5번부터'), r.stdout);
  assert.ok(!r.stdout.includes('단계 되돌리기'), r.stdout);
});

// WP-1993 simplify — 처리 파일 토큰은 file_of 헬퍼(ver_of 옆)로 한 번만 뽑고 redo_line 은 그 값을 쓸 뿐이다(서브셸 안 반복 계산 없음, local 은 POSIX 아님).
test('procedure-check: file_of 헬퍼로 flow_token 을 한 번만 구하고 redo_line 은 다시 파싱하지 않는다 (WP-1993 simplify)', () => {
  const src = readFileSync(script, 'utf8');
  assert.ok(src.indexOf('ver_of() {') >= 0 && src.indexOf('file_of() {') > src.indexOf('ver_of() {'), 'file_of 가 ver_of 옆에 없다');
  assert.equal(src.split('flow_token=$(').length - 1, 2, 'flow_token 계산이 처리 파일 줄 있음·없음 두 곳 밖에 있다');
  const start = src.indexOf('redo_line() {');
  assert.ok(start >= 0, 'redo_line 함수를 찾지 못함');
  const end = src.indexOf('\n}\n', start);
  assert.ok(end > start, 'redo_line 의 닫는 } 를 찾지 못함');
  const fn = src.slice(start, end);
  assert.ok(!/\blocal\b/.test(fn), 'POSIX sh 에 local 은 없다');
  assert.ok(!fn.includes('sed') && !fn.includes('grep'), 'redo_line 이 파일 토큰을 다시 파싱한다');
  assert.ok(src.indexOf('flow_token=$(') < start, 'flow_token 은 redo_line 앞에서 한 번 구한다');
});
