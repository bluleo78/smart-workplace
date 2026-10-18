// 플러그인 스킬 형식 테스트(WP-419) — skills/<이름>/SKILL.md 앞머리의 name 이 폴더 이름과 같고 description 이 있어야 /genia-works:<이름> 으로 불린다.
// 스킬이 부르는 도구·인자가 실제 도구 정의에 있는지는 packages/mcp-tools-shared 의 plugin-skills.test.ts 가 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const skillsDir = new URL('../skills/', import.meta.url);

test('스킬 폴더마다 SKILL.md 의 name 이 폴더 이름과 같고 description 이 있다', () => {
  const dirs = readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.ok(dirs.includes('work-on'));
  assert.ok(dirs.includes('work-loop'));
  assert.ok(dirs.includes('work-done'));
  for (const dir of dirs) {
    const head = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(readFileSync(new URL(`${dir}/SKILL.md`, skillsDir), 'utf8'))?.[1] ?? '';
    assert.equal(/^name: ["']?([^"'\r\n]+)["']?\r?$/m.exec(head)?.[1], dir);
    assert.match(head, /^description: \S/m, `${dir}: description 이 없다`);
  }
});

// WP-376 work-loop — 순서가 바뀌면 사고가 나는 지점을 문구 위치로 고정한다.
// 없는 문구는 indexOf 가 -1 이라 비교가 거짓으로 통과하므로, 먼저 있는지부터 본다.
const workLoop = (file) => readFileSync(new URL(`work-loop/${file}`, skillsDir), 'utf8');
const body = (text) => text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
function assertBefore(text, first, second) {
  const a = text.indexOf(first);
  const b = text.indexOf(second);
  assert.ok(a > -1, `「${first}」 가 없다`);
  assert.ok(b > -1, `「${second}」 가 없다`);
  assert.ok(a < b, `「${first}」 가 「${second}」 보다 먼저 나와야 한다`);
}

test('work-loop SKILL.md 는 신원 확인(get_member)이 후보 고르기(list_issues)보다 먼저 나온다', () => {
  // 내 토큰 세션이면 이슈를 건드리기 전에 멈춰야 한다 — 후보를 먼저 고르면 사람 이름으로 보고가 남는다.
  assertBefore(body(workLoop('SKILL.md')), '`get_member(', '`list_issues(');
});

test('process-issue.md 에서 「브랜치 라이브 검증」이 「main 머지」보다 먼저 나온다', () => {
  // 검증에 실패한 변경이 main 에 들어가 배포 전 일괄 push 로 나가면 안 된다.
  assertBefore(workLoop('process-issue.md'), '\n### 8. 브랜치 라이브 검증\n', '\n### 9. main 머지\n');
});

test('SKILL.md 의 후보 표에 PAUSED 행이 「고르지 않는다」로 있다', () => {
  // 사람이 멈춘 작업을 AI 가 다시 집어 들면 안 된다.
  assert.match(workLoop('SKILL.md'), /^\|[^\n]*PAUSED[^\n]*\|[^\n]*고르지 않는다[^\n]*\|\s*$/m);
});

// WP-451 본문 지시·다음 회차 대기 — 빠지면 반복 업무가 멈추거나 1분마다 헛돌거나 같은 날 하위가 두 번 생긴다.
test('SKILL.md 의 후보 표에 SCHEDULED 행이 nextRunAt 기준으로 있다', () => {
  assert.match(workLoop('SKILL.md'), /^\|[^\n]*SCHEDULED[^\n]*\|[^\n]*`nextRunAt`[^\n]*\|\s*$/m);
});

test('SKILL.md 순서에서 시각이 지난 다음 회차 대기가 우선순위보다 먼저다', () => {
  assertBefore(workLoop('SKILL.md'), '③ `nextRunAt` 이 지난 다음 회차 대기', '④ 우선순위');
});

test('SKILL.md 다음 확인에서 미뤄 둔 후보(시각 없는 대기·머지 대기)는 남은 후보로 세지 않는다', () => {
  // 시각 없는 대기 하나만 남았을 때 1분마다 깨어나 헛도는 것을 막는다.
  const text = workLoop('SKILL.md');
  assert.ok(text.includes('`nextRunAt` 이 없는 다음 회차 대기와 **main 머지 대기**'));
  assert.ok(text.includes('미뤄 둔 후보(3번)는 「남은 후보」로 세지 않는다'));
});

test('본문 지시 회차: 하위를 만들기 전 닫힌 하위까지 보고, 닫을 때 요약을 먼저 남긴다', () => {
  const text = workLoop('process-issue.md');
  const section = text.slice(text.indexOf('\n### 본문 지시 회차\n'));
  assert.ok(section.length > 30, '「본문 지시 회차」 절이 없다');
  // 그날 할 일을 마쳐 닫은 하위를 못 보면 같은 날 하위가 또 생긴다.
  assert.ok(section.includes("status: 'TODO,IN_PROGRESS,DONE,CANCELED'"));
  // 내가 오늘 만든 하위로 찾아야 제목·마감이 바뀐 하위도 잡고, 사람이 따로 만든 하위에 막히지 않는다.
  assert.ok(section.includes("reporter: 'me'"));
  assert.ok(section.includes('createdFrom: <오늘>, createdTo: <오늘>'));
  // 이슈를 먼저 닫으면 서버가 작업을 끝내 요약을 남길 수 없다(완료·취소된 이슈에는 보고 불가).
  assertBefore(section, '마지막 요약', "`update_issue({ issueKey, status: 'DONE' })`");
  // 결함 중복 검색은 assignee 를 빼면 내 이슈만 본다.
  assert.ok(section.includes("assignee: 'any', q: <제목 핵심어>"));
});

test('SKILL.md 다음 확인은 /loop 반복일 때만 잡는다', () => {
  // 직접 한 번 부른 실행이 깨우기를 예약하면 사람이 모르는 반복이 생긴다(라이브 검증에서 나왔다).
  assert.ok(workLoop('SKILL.md').includes('`/genia-works:work-loop …` 를 직접 부른 경우는'));
});

test('SKILL.md 본문 지시는 허락 범위와 바꾸지 못하는 규칙을 적는다', () => {
  // 본문은 누구나 고칠 수 있어(메일 이슈 포함) 권한을 좁혀 두지 않으면 본문으로 push·검증 없는 머지를 시킬 수 있다.
  const text = workLoop('SKILL.md');
  assert.ok(text.includes('본문이 허락하는 닫기'));
  assert.ok(text.includes('본문이 바꾸지 못하는 것'));
});

// WP-453 AI 끼리 협업 — 이슈 만들기·담당 바꾸기는 사람처럼 하되, 담당을 바꾼 이유가 이슈에 남아야 사람이 흐름을 따라간다.
test('SKILL.md 는 이슈 만들기를 막지 않고 담당을 바꿀 때 이유를 댓글로 남기게 한다', () => {
  const text = workLoop('SKILL.md');
  assert.ok(!text.includes('이슈 생성(필요하면 이슈 챗에 제안만'), '이슈 생성 금지가 남아 있다');
  assert.ok(text.includes('이슈 만들기·담당 바꾸기는 사람처럼 한다'));
  assert.ok(text.includes('담당자를 바꿀 때는(넣든 빼든) 그 이슈에 이유를 댓글로 남긴다'));
});

// WP-455 — 이름만 보고 넘기면 엉뚱한 AI 에게 가고, 내부 AI 에게 넘기면 아무도 시작하지 않아 일이 멈춘다.
test('SKILL.md 는 맡길 AI 를 설명으로 고르고 내부 AI 는 피하게 한다', () => {
  const text = workLoop('SKILL.md');
  assert.ok(text.includes("`search_members({ kind: 'AGENT' })`"));
  assert.ok(text.includes('`agentRuntime` 이 `INTERNAL` 인 AI 는 다른 AI 가 맡겨도 시작하지 않으니 맡기지 않는다'));
});
