// WP-1836 procedure-check 테스트 — 임시 git 저장소(MAIN)에 notes·계획 파일·원장을 만들고 cwd=MAIN 으로 스크립트를 돌려
// 「절차」 줄·계획 파일·SDD 원장 검사가 통과/실패/예외를 바르게 가르는지, 실패 문구와 종료 코드가 맞는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
  '절차: 처리 파일 process-issue.md (플러그인 0.1.68) → brainstorming(Skill) → writing-plans(Skill, docs/superpowers/plans/p.md) → ' +
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
  notes(main, '아무 내용\n');
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

test('실패 — 계획 파일 없음', (t) => {
  const main = repo(t);
  notes(main, `${GOOD}\n\n${LEDGER}`);
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
  notes(main, '리뷰 후속: 1490\n마지막 완료 단계: 리뷰 후속 수정\n');
  const r = run(main);
  ok(r);
  assert.ok(r.stdout.includes('통과(리뷰 후속 수정 — 앞 PR 의 절차를 씀)'));
});

test('예외 — executing-plans 와 까닭', (t) => {
  const main = repo(t);
  notes(main, '절차: 처리 파일 process-issue.md (플러그인 0.1.68) → executing-plans(까닭: 하위 에이전트 도구 없음) → /code-review medium(지적 0) → /simplify\n');
  ok(run(main));
});

test('전환 — 플러그인 0.1.50 은 계획 파일·원장을 보지 않음', (t) => {
  const main = repo(t);
  notes(main, `${GOOD.replace('0.1.68', '0.1.50')}\n`);
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
  notes(main, `${GOOD.replace('0.1.68', '0.1.67')}\n`);
  const r = run(main);
  ok(r);
  assert.ok(r.stdout.includes('[procedure-check] WP-1: 참고 — 0.1.68 전 절차라 notes 원장 절이 없음, 원장 줄은 PR 본문으로 검토자가 본다'), r.stdout);
});

test('전환 — 0.1.68 + 원장 없음 → 1', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD}\n`);
  fail(run(main), 'SDD 원장이 없습니다');
});

test('전환 — 0.1.55 경계: 0.1.54 는 계획·원장 생략, 0.1.55 + 원장 없음은 참고', (t) => {
  const main = repo(t);
  notes(main, `${GOOD.replace('0.1.68', '0.1.54')}\n`);
  ok(run(main));
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD.replace('0.1.68', '0.1.55')}\n`);
  const r = run(main);
  ok(r);
  assert.ok(r.stdout.includes('참고'), r.stdout);
});

test('전환 — 0.1.67 + 계획 파일 없음은 여전히 실패', (t) => {
  const main = repo(t);
  notes(main, `${GOOD.replace('0.1.68', '0.1.67')}\n`);
  fail(run(main), '계획 파일이 없습니다');
});

test('전환 — 0.1.67 + 원장 있으면 검사한다', (t) => {
  const main = repo(t);
  plan(join(main, '.claude/worktrees/WP-1'));
  notes(main, `${GOOD.replace('0.1.68', '0.1.67')}\n\n원장:\nTask 1: complete (a)\n`);
  fail(run(main), 'Task 2 완료 줄이 없습니다');
});

test('전환 — 버전 없음 → 0', (t) => {
  const main = repo(t);
  notes(main, `${GOOD.replace(' (플러그인 0.1.68)', '')}\n`);
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
  notes(main, `${GOOD}\n\n${LEDGER}`);
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
  fail(run(main), 'subagent-driven-development 괄호 안에 모델이 없습니다');
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
  notes(main, `${GOOD}\n\n${LEDGER}`);
  fail(run(main), '[procedure-check] WP-1: 계획 파일이 없습니다');
  notes(main, '아무 내용\n');
  fail(run(main), '[procedure-check] WP-1: 절차: 줄이 없습니다');
});

test('까닭 대안 줄에 자리 표시가 남으면 자리 표시 실패만', (t) => {
  const main = repo(t);
  notes(main, '절차: 처리 파일 process-issue.md (플러그인 0.1.68) → executing-plans(까닭: <까닭>) → /simplify\n');
  const r = run(main);
  fail(r, '자리 표시가 남아 있습니다: <까닭>');
  assert.ok(!r.stdout.includes('brainstorming'), r.stdout);
});

test('예외 — without-superpowers.md 와 까닭 → 0', (t) => {
  const main = repo(t);
  notes(main, '절차: 처리 파일 without-superpowers.md (플러그인 0.1.68) → 까닭: 스킬 도구 없는 실행기\n');
  ok(run(main));
});

test('실패 — executing-plans 인데 까닭 없음', (t) => {
  const main = repo(t);
  notes(main, '절차: 처리 파일 process-issue.md (플러그인 0.1.68) → executing-plans → /code-review medium(지적 0) → /simplify\n');
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

test('리뷰 후속 — 마지막 완료 단계가 리뷰 후속 수정일 때만 예외', (t) => {
  const main = repo(t);
  notes(main, '리뷰 후속: 12\n마지막 완료 단계: 리뷰 후속 수정\n');
  ok(run(main));
  notes(main, '리뷰 후속: 12\n마지막 완료 단계: 5. 설계·구현\n');
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
  notes(main, `${GOOD.replace('0.1.68', '0.1.08')}\n`);
  ok(run(main));
});
