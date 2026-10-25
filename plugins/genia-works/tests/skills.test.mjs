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

test('process-issue.md 에서 「브랜치 라이브 검증」이 「PR」보다 먼저 나온다', () => {
  // 검증에 실패한 변경을 PR 로 올리면 검토자가 그것을 머지할 수 있다.
  assertBefore(workLoop('process-issue.md'), '\n### 8. 브랜치 라이브 검증\n', '\n### 9. PR\n');
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

test('SKILL.md 다음 확인에서 미뤄 둔 후보(시각 없는 대기)는 남은 후보로 세지 않는다', () => {
  // 시각 없는 대기 하나만 남았을 때 1분마다 깨어나 헛도는 것을 막는다.
  const text = workLoop('SKILL.md');
  assert.ok(text.includes('`nextRunAt` 이 없는 다음 회차 대기(PR 을 두고 기다리는 이슈는 빼고)'));
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

// WP-516 근거 첨부 — 로컬 경로만 적으면 다른 환경의 사람은 결함 화면·시안·검증 스크린샷을 볼 수 없다.
test('SKILL.md 근거 이미지·파일은 첨부로 올리고, 이슈 설명은 이슈에·질문·보고 근거는 그 글에 붙인다', () => {
  const text = workLoop('SKILL.md');
  assert.ok(!text.includes('이미지는 올리지 않는다'));
  assert.ok(text.includes('`upload_file({ name })`'));
  assert.ok(text.includes('`create_issue` 의 `fileIds`'));
  assert.ok(text.includes('`report_agent_work` 의 `fileIds`'));
  assert.ok(text.includes('같은 파일을 두 곳에 올리지 않는다'));
  // 첨부가 만료·이미 붙은 파일이면 보고 전체가 거절된다 — 첨부 없이 다시 보내야 상태 보고가 사라지지 않는다.
  assert.ok(text.includes('`fileIds` 를 빼고 다시 보내며'));
});

// WP-800 대기열 라벨 — 할 일이 없는 AI 가 라벨이 붙은 이슈를 하나 가져간다. 할 일이 있는데 가져가면 일을 쌓아 두고,
// 하나보다 많이 가져가면 다른 AI 몫을 막는다. 넘길 때 AI 를 담당으로 넣으면 아무도 가져갈 수 없다(AI_ALREADY_ASSIGNED).
const section = (text, from, to) => {
  const a = text.indexOf(from);
  const b = text.indexOf(to, a + 1);
  assert.ok(a > -1 && b > a, `「${from}」~「${to}」 절이 없다`);
  return text.slice(a, b);
};

// 3번(후보 고르기) 본문 — 대기열 가져오기 테스트들이 함께 쓴다.
const s3 = section(workLoop('SKILL.md'), '\n### 3. 후보 고르기\n', '\n### 4. ');
// 한 줄을 찾는다 — 없으면 빈 문자열로 넘어가 뒤 단언이 엉뚱하게 실패하지 않게 여기서 바로 알린다.
function lineWith(text, needle) {
  const line = text.split('\n').find((l) => l.includes(needle));
  assert.ok(line, `「${needle}」 가 든 줄이 없다`);
  return line;
}

test('SKILL.md 인자에 --queue 가 있다', () => {
  const text = body(workLoop('SKILL.md'));
  assert.ok(text.includes('`<프로젝트 키> [--queue "<라벨>"]`'));
  assert.ok(text.includes('/loop /genia-works:work-loop WP --queue "AI 개발팀"'));
});

test('SKILL.md 3번: 고를 후보가 없을 때만 대기열에서 최대 하나를 가져가고, 그 뒤에 「할 일 없음」으로 끝낸다', () => {
  assert.ok(s3.includes("`list_issues({ projectKey, label: <대기열 라벨>, assignee: 'any', status: 'TODO,IN_PROGRESS' })`"));
  assert.ok(s3.includes("`kind: 'AGENT'`"));
  assert.ok(s3.includes('`claim_issue({ issueKey, queueLabel: <대기열 라벨> })`'));
  assert.ok(s3.includes('`NOT_IN_QUEUE`'));
  assert.ok(s3.includes('`AI_ALREADY_ASSIGNED`'));
  assert.ok(s3.includes('최대 하나'));
  // 미뤄 둔 후보까지 없을 때만 가져간다 — 가져오기 단계가 「할 일 없음」 결론보다 먼저 나와야 한다.
  assertBefore(s3, '`claim_issue(', '가져간 이슈가 없으면 「할 일 없음」으로 끝낸다');
});

test('SKILL.md 3번: 목록과 가져가기 사이에 대기열을 떠난 이슈(ISSUE_CLOSED 포함)는 다음 후보로 넘어간다', () => {
  // 그 사이 닫힌 이슈 하나 때문에 나머지 대기열을 두고 멈추면 할 일 없는 AI 가 한 번을 헛돈다.
  const moveOn = lineWith(s3, '다음 이슈로 간다');
  for (const code of ['`NOT_IN_QUEUE`', '`AI_ALREADY_ASSIGNED`', '`ISSUE_CLOSED`']) assert.ok(moveOn.includes(code), `${code} 가 다음 후보로 넘어가는 줄에 없다`);
  const stop = lineWith(s3, '더 시도하지 않고');
  assert.ok(stop.includes('`CLAIM_AGENT_ONLY`'), '멈추는 줄에 CLAIM_AGENT_ONLY 가 없다');
  assert.ok(!stop.includes('`ISSUE_CLOSED`'), 'ISSUE_CLOSED 가 멈추는 줄에 있다');
});

test('SKILL.md 3번: 대기열 라벨이 프로젝트에 아직 없어 목록이 실패하면 오류가 아니라 빈 대기열로 본다', () => {
  // 서버 문구가 아니라 안정적인 부분(label 필터 오류 400)에 건다.
  const line = lineWith(s3, '`label` 필터 오류');
  assert.ok(line.includes('400'), '400 이 줄에 없다');
  assert.ok(line.includes('빈 대기열'), '라벨 없음 → 빈 대기열 줄이 없다');
  assertBefore(s3, '`label` 필터 오류', '`claim_issue(');
});

test('SKILL.md 5번: 가져갔으면 처리할 후보가 남은 것과 같게 다룬다', () => {
  const text = workLoop('SKILL.md');
  const s5 = text.slice(text.indexOf('\n### 5. 다음 확인\n'));
  assert.ok(s5.includes('대기열에서 이슈를 가져갔으면'));
});

test('SKILL.md 넘기기: 대기열 라벨이 있는 역할은 AI 를 담당으로 넣지 않고 라벨을 붙인다', () => {
  const text = workLoop('SKILL.md');
  assert.ok(text.includes('대기열 라벨이 있는 역할은 라벨로 넘긴다'));
  assert.ok(text.includes('어떤 AI 도 담당으로 넣지 않는다'));
  assert.ok(text.includes('`update_issue` 의 `labels` 도 통째로 바꾸는 집합이다'));
  // 대기열이 없는 역할은 WP-455 대로 설명을 보고 고른다 — 그 규칙보다 먼저 나와야 넘길 때 먼저 본다.
  assertBefore(text, '대기열 라벨이 있는 역할은 라벨로 넘긴다', "`search_members({ kind: 'AGENT' })`");
});

test('.work-loop/project.md 에 역할별 대기열 라벨(개발 일 → AI 개발팀)이 있다', () => {
  const project = readFileSync(new URL('../../../.work-loop/project.md', import.meta.url), 'utf8');
  const s6 = project.slice(project.indexOf('\n## 6. 대기열 라벨'));
  assert.ok(s6.length > 20, '「6. 대기열 라벨」 절이 없다');
  assert.match(s6, /^\|[^\n]*개발[^\n]*\|[^\n]*`AI 개발팀`[^\n]*\|\s*$/m);
});

// WP-913 — REVIEW 보고는 맡긴 사람에게 검토 요청 알림을 보낸다. 바로 완료할 때는 WORKING 으로 보고한 뒤 DONE 으로 바꿔 알림 없이 닫는다.
test('work-done 「완료」는 검토 대기(REVIEW)를 거치지 않는다', () => {
  const doc = readFileSync(new URL('work-done/SKILL.md', skillsDir), 'utf8');
  const row = doc.split('\n').find((l) => l.startsWith('| 완료 |'));
  assert.ok(row && row.includes("state: 'WORKING'") && !row.includes('REVIEW'));
});

// WP-963 PR 흐름 — 개발 AI 는 main 에 머지하지 않고 PR 을 올리고, 검토자(AI 팀장)가 리뷰·rebase·머지한다.
const pi = workLoop('process-issue.md');

test('SKILL.md: push 는 PR 흐름에서만 하고 main 직접 push·gitlab push 는 하지 않는다', () => {
  const text = workLoop('SKILL.md');
  assert.ok(!text.includes('**하지 않는다**: push,'), '예전 push 전면 금지가 남아 있다');
  assert.ok(text.includes('main 직접 push'));
  assert.ok(text.includes('push 는 PR 흐름에서만 한다'));
});

test('SKILL.md: gh 가 준비되지 않았으면 스스로 설치·로그인하지 않고 AUTH_REQUIRED 로 멈춘다', () => {
  // 무인 세션이 바이너리를 받아 깔거나 토큰을 만들면 사람이 모르는 것이 생긴다.
  const line = lineWith(workLoop('SKILL.md'), 'GitHub 준비는 스스로 하지 않는다');
  assert.ok(line.includes('`gh auth status`'));
  assert.ok(line.includes('`AUTH_REQUIRED`'));
});

test('process-issue.md: 남이 만든 PR 이면 1번보다 먼저 검토자 절로 간다', () => {
  // 검토자가 개발 절차부터 시작하면 남의 이슈를 다시 구현한다.
  assertBefore(pi, '**먼저 갈래를 본다**', '\n### 1. 시작\n');
  assert.ok(pi.includes('\n### PR 리뷰·머지 (검토자)\n'));
});

test('process-issue.md: 개발 순서는 PR → PR 리뷰 대기 → 검토 대기이고 MAIN 에 머지하지 않는다', () => {
  assertBefore(pi, '\n### 9. PR\n', '\n### 10. PR 리뷰 대기\n');
  assertBefore(pi, '\n### 10. PR 리뷰 대기\n', '\n### 11. 검토 대기\n');
  assert.ok(!pi.includes('git -C MAIN merge'), 'MAIN 머지가 남아 있다');
  assert.ok(!pi.includes('merge-ready'), 'merge-ready 가 남아 있다');
  // 리뷰를 기다리는 동안 REVIEW 로 올리면 main 에 없는 코드로 사람에게 검토 요청 알림이 간다.
  const s10 = section(pi, '\n### 10. PR 리뷰 대기\n', '\n### 11. ');
  assert.ok(s10.includes("state: 'SCHEDULED', note: 'PR #<번호> 리뷰 대기'"));
  assert.ok(s10.includes('`nextRunAt` 은 넣지 않는다'));
});

test('process-issue.md 검토자: 리뷰 → rebase → push(게이트) → 머지 순서이고 반려는 SCHEDULED 로 기다린다', () => {
  const lead = pi.slice(pi.indexOf('\n### PR 리뷰·머지 (검토자)\n'), pi.indexOf('\n### 막힘\n'));
  assert.ok(lead.length > 100, '검토자 절이 없다');
  assertBefore(lead, '**리뷰**', '`git rebase origin/main`');
  // push 때 도는 pre-push 게이트가 합친 결과를 검증한다 — 그 전에 머지하면 테스트 안 된 조합이 main 에 들어간다.
  assertBefore(lead, '`git push --force-with-lease origin <브랜치>`', '`gh pr merge');
  assert.ok(lead.includes("state: 'SCHEDULED', note: 'PR #<번호> 수정 대기'"));
  // 동작을 바꿔야 풀리는 충돌은 검토자가 풀지 않는다.
  assert.ok(lead.includes('동작을 바꿔야 풀리는 충돌이면'));
});

test('SKILL.md: PR 을 두고 기다리는 이슈는 새 글이 있을 때만 고르고, 답하지 않고 넘긴 글을 적어 둔다', () => {
  const text = workLoop('SKILL.md');
  assert.match(text, /^\|[^\n]*SCHEDULED[^\n]*「PR 리뷰 대기」·「PR 수정 대기」[^\n]*\|\s*$/m);
  // pendingForMe 는 내가 글을 남겨야 풀린다 — 적어 두지 않으면 AI 끼리 답을 주고받거나 같은 이슈를 매번 다시 고른다.
  assert.ok(text.includes('`MAIN/.work-loop/state/seen/<이슈 키>`'));
});

test('.work-loop/project.md 에 PR 절과 검토자 절이 있다', () => {
  const project = readFileSync(new URL('../../../.work-loop/project.md', import.meta.url), 'utf8');
  assert.ok(project.includes('\n## 7. PR'));
  assert.ok(project.includes('\n## 8. 검토자'));
  assert.ok(project.includes('`gh pr merge --merge`'));
});

test('process-issue.md: 개발자·검토자는 GitHub 계정이 아니라 PR 본문의 genia-works 신원으로 가린다', () => {
  // AI 들이 GitHub 계정 하나를 같이 쓰면 작성자로 가를 때 검토자가 남의 PR 을 자기 것으로 보고 다시 구현한다.
  assert.ok(!pi.includes('gh api user'), 'GitHub 계정으로 가르는 문구가 남아 있다');
  assert.ok(pi.includes('`개발: <username>` 줄이 내'));
  assert.ok(pi.includes('본문 첫 줄은 `개발: <내 username>`'));
});

test('SKILL.md: AI 담당자가 여럿이면 멘션된 AI 만 반응하고 나머지는 넘긴 글로 적는다', () => {
  // 개발자·검토자가 같은 글을 모두 받아, 기준이 없으면 둘 다 답하거나 둘 다 넘긴다.
  const line = lineWith(workLoop('SKILL.md'), '누구에게 한 글인가');
  assert.ok(line.includes('멘션된 AI 만 반응하고'));
  assert.ok(line.includes('「답하지 않고 넘긴 글」'));
});
