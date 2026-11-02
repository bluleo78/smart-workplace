// 4 type envelope → Claude CLI 에 넘길 user message 문자열 변환.
// spec §"Type 별 user message" 와 일치.
import type { IssueEventEnvelope, IssueRecurringRunPayload } from '../types/issue-events.js';
import { RECURRING_QUESTION_MARKER } from './system-prompt.js';
import { RECURRING_TEST_GATED_TOOLS } from '../mcp/tools.js';

const KST_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// WP-989: 회차 시각(ISO)을 한국 시각 "YYYY-MM-DD(요일) HH:mm KST" 로 — 서버 시간대와 무관하게 +9시간으로 계산한다.
// 읽을 수 없는 값이면 원문 그대로 둔다(지시문이 깨지지 않게).
export function formatKst(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t + 9 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `(${KST_WEEKDAYS[d.getUTCDay()]}) ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} KST`
  );
}

// WP-989·WP-1312: 반복 회차 지시문과 이어 처리 지시문이 같이 쓰는 조각 — 본문 대체 문구·이슈 머리 줄·도구 권한 줄·결과 글 규칙.
const NO_BODY = '(본문 없음 — 제목을 보고 할 일을 판단하세요)';

function recurringBody(p: IssueRecurringRunPayload): string {
  return p.issueBody?.trim() ? p.issueBody.trim() : NO_BODY;
}

// 이슈키·제목·반복 규칙 세 줄.
function recurringIssueLines(p: IssueRecurringRunPayload): string {
  return `이슈키: ${p.issueKey}\n` + `제목: ${p.issueTitle}\n` + `반복: ${p.recurrence.rrule} · ${p.recurrence.time} KST\n`;
}

// 도구 권한 줄 — 도구는 API 가 정한 신원(ownerUserId)으로 돈다(WP-1314). 신원이 AI 자신이면 사람을 대신하지 않는다 — 그 AI 가 볼 수 있는
// 것만 다룬다. 아니면 요청자(actor) 대행이다.
function ownerToolsRule(p: IssueRecurringRunPayload): string {
  return p.ownerUserId === p.actingAgentId
    ? `- 도구는 당신(이 AI) 자신의 권한으로 동작합니다 — 이 프로젝트처럼 당신이 볼 수 있는 이슈·노트 등만 조회하고 다룹니다.\n`
    : `- 도구는 요청자(@${p.actor?.username ?? '등록한 사람'})의 권한으로 동작합니다 — 그 사람의 메일·일정·노트·이슈 등을 직접 조회하고 다룹니다.\n`;
}

// 최종 답변이 그대로 이슈 챗 글이 된다는 마지막 규칙. what = 무엇의 결과인지, content = 쓸 내용.
function chatResultRule(what: string, content: string): string {
  return `- 최종 답변이 그대로 이슈 챗에 남는 ${what}입니다. 인사·과정 설명 없이 ${content} 간결한 한국어 마크다운으로 쓰세요.`;
}

// WP-1313: 「지금 실행」(테스트 실행) 규칙. 테스트 실행은 되돌릴 수 없는 쓰기(mcp/tools.ts RECURRING_TEST_GATED_TOOLS) 직전에 멈춘다 —
// 그 도구는 recurring-test 프로필에서 실행되지 않고 「멈춤」 결과를 돌려주며(run-recurring 이 멈춘 쓰기를 모아 질문으로 보고한다), 모델은 같은
// 질문 표지로 확인을 요청한다. 이슈 본문이 「바로 보내라」여도 한 번은 묻는다. 되돌릴 수 있는 쓰기는 정기 회차처럼 바로 한다.
// 멈추는 도구의 사람 말 이름 — 지시문에 보일 순서대로 둔다. 지시문 목록은 RECURRING_TEST_GATED_TOOLS 에서 만들어 둘이 어긋나지 않게 한다
// (여기에 이름이 없는 새 멈춤 도구도 도구 이름으로 목록에 들어간다 — user-message.test.ts 가 모든 멈춤 도구에 이름이 있는지 고정한다).
export const TEST_GATED_LABELS: Readonly<Record<string, string>> = {
  send_mail: '메일 보내기',
  create_event: '일정 만들기(참석자 초대 포함)',
  update_event: '일정 고치기(참석자 초대 포함)',
  delete_event: '일정 지우기',
  delete_external_contact: '연락처 지우기',
  delete_user_group: '사용자 그룹 지우기',
  create_project: '프로젝트 만들기',
  add_project_member: '프로젝트 구성원 추가',
  add_channel_member: '채널 초대',
};

// 테스트 실행 지시문에 넣는 멈추는 쓰기 목록 — 멈춤 도구만, 이름 표의 순서로, 표에 없는 도구는 끝에 도구 이름으로.
export const TEST_GATED_DESC = [
  ...Object.keys(TEST_GATED_LABELS).filter((n) => RECURRING_TEST_GATED_TOOLS.has(n)),
  ...[...RECURRING_TEST_GATED_TOOLS].filter((n) => !(n in TEST_GATED_LABELS)),
]
  .map((n) => TEST_GATED_LABELS[n] ?? n)
  .join(', ');

// 멈춘 쓰기 인자를 지시문에 보일 때의 길이 상한 — 긴 메일 본문 등은 줄인다(같은 쓰기를 다시 하기 위한 참고일 뿐이다).
const PERMITTED_ARGS_MAX_CHARS = 1500;

function testRunRule(): string {
  return (
    `- 이번은 사람이 「지금 실행」으로 시험해 보는 테스트 실행입니다(정기 회차 일정과 관계없다). 되돌릴 수 있는 쓰기는 정기 회차처럼 바로 하되, ` +
    `되돌릴 수 없는 쓰기(${TEST_GATED_DESC})는 이슈 본문이 바로 하라고 해도 먼저 확인을 받습니다 — 그런 도구는 실행되지 않고 「멈춤」 결과를 돌려줍니다. ` +
    `멈춘 쓰기를 다시 시도하거나 다른 도구로 돌아가 하지 말고, 최종 답변 첫 줄을 \`${RECURRING_QUESTION_MARKER}\` 로 시작해 하려던 쓰기(받는 사람·제목·일시 등 핵심 내용)와 그때까지 한 일을 적고 진행해도 될지 물으세요.\n`
  );
}

// 테스트 질문의 이어 처리 규칙 — 확인받은 쓰기(그 질문이 멈춘 도구)만 실행할 수 있다. 그 밖의 되돌릴 수 없는 쓰기는 또 멈춘다.
function testFollowUpRule(f: NonNullable<IssueRecurringRunPayload['followUp']>): string {
  const permitted = f.permittedActions ?? [];
  const lines = permitted.map((a) => {
    const args = a.args ? JSON.stringify(a.args) : '';
    const shown = args.length > PERMITTED_ARGS_MAX_CHARS ? `${args.slice(0, PERMITTED_ARGS_MAX_CHARS)}…` : args;
    return `  - ${a.tool}${shown ? ` ${shown}` : ''}`;
  });
  return (
    `- 이번은 「지금 실행」(테스트 실행)의 이어 처리입니다. ` +
    (lines.length
      ? `확인을 받으려고 멈췄던 쓰기는 아래와 같습니다 — 답이 허락하면 이 쓰기만 실행할 수 있습니다(답이 바꾸라고 한 부분은 바꿔서, 하지 말라고 하면 하지 않습니다).\n${lines.join('\n')}\n`
      : `확인받은 되돌릴 수 없는 쓰기는 없습니다.\n`) +
    `- 그 밖의 되돌릴 수 없는 쓰기(${TEST_GATED_DESC})는 도구가 또 멈춥니다 — 필요하면 하지 말고 최종 답변 첫 줄을 \`${RECURRING_QUESTION_MARKER}\` 로 시작해 다시 물으세요.\n`
  );
}

// WP-1313: 지시문 머리의 이벤트 이름 — 테스트 실행(「지금 실행」)이면 issue.recurring_test_run, 정기 회차면 issue.recurring_run.
function recurringEventType(test: boolean): string {
  return test ? 'issue.recurring_test_run' : 'issue.recurring_run';
}

// WP-1312: 회차가 남긴 질문에 반복을 저장한 사람이 답해 이어 하는 실행의 지시문. 회차와 같은 신원·권한·도구로 돌고 결과가 이슈 챗에 남는 것도 같다 —
// 이번에는 질문과 답을 주고, 이슈 본문에 따라 멈췄던 일을 답대로 이어 하게 한다. 또 확인이 필요하면 같은 질문 표지로 다시 묻는다(대화가 이어진다).
// 답한 사람은 actor(반복을 저장한 사람)다 — 그 사람만 답할 수 있다. 도구 신원 줄은 정기 회차와 같은 ownerToolsRule 이다(WP-1314).
// WP-1313: test 면 테스트 질문의 이어 처리 — 확인받은 쓰기만 허락하는 규칙을 더한다(답한 사람은 「지금 실행」을 누른 사람).
function buildRecurringFollowUpMessage(
  p: IssueRecurringRunPayload,
  f: NonNullable<IssueRecurringRunPayload['followUp']>,
  test: boolean,
): string {
  const who = p.actor.name ? `${p.actor.name}(@${p.actor.username})` : `@${p.actor.username}`;
  return (
    `[이벤트: ${recurringEventType(test)} · 이어 처리]\n` +
    `반복 작업의 회차가 남긴 질문에 ${who} 님이 이슈 챗에서 답했습니다. 그 회차를 이어서 처리하세요. 답한 시각: ${formatKst(p.runAt)}\n` +
    recurringIssueLines(p) +
    `\n## 이슈 본문 (반복 작업이 할 일)\n${recurringBody(p)}\n\n` +
    `## 남겼던 질문\n${f.question.trim() || '(질문 본문 없음)'}\n\n` +
    `## ${who} 님의 답\n${f.answer.trim()}\n\n` +
    `## 이어 처리 규칙\n` +
    `- 질문에서 멈췄던 일을 이 답에 따라 이슈 본문대로 이어서 하세요. 답이 진행을 허락하면 그 쓰기를 확인 카드 없이 바로 하고, 하지 말라고 하면 하지 않습니다. 질문·이슈 본문과 상관없는 일은 하지 않습니다.\n` +
    `- 답만으로 정할 수 없거나 이슈 본문이 다음 쓰기 전에 또 확인을 받으라고 하면, 그 쓰기를 하지 말고 최종 답변 첫 줄을 \`${RECURRING_QUESTION_MARKER}\` 로 시작해 다시 물으세요.\n` +
    (test ? testFollowUpRule(f) : '') +
    ownerToolsRule(p) +
    chatResultRule('이어 처리 결과', '한 일과 결과만')
  );
}

// WP-989·WP-1311: 반복 작업(실행 일정)의 회차 실행 지시문. 도구는 API 가 정한 신원(ownerUserId)으로 돈다 — 개인 비서면 주인, 그 밖의 AI 는
// 자기 자신(WP-1314). 사람이 지켜보지 않는 실행이라 확인 카드를 띄울 수 없으므로 본문이 시킨 쓰기는 바로 하고, 본문이 확인을 받으라고 한
// 쓰기는 하지 않고 질문 표지로 묻게 한다. 최종 답변이 그대로 이슈 챗에 올라간다.
// WP-1312: 이어 처리(followUp 이 실린 회차)면 이어 처리 지시문을 쓴다.
// WP-1313: test(issue.recurring_test_run)면 「지금 실행」 테스트 실행 — 되돌릴 수 없는 쓰기 전에 멈추고 묻는 규칙을 더한다.
export function buildRecurringRunMessage(p: IssueRecurringRunPayload, opts: { test?: boolean } = {}): string {
  const test = opts.test === true;
  if (p.followUp) return buildRecurringFollowUpMessage(p, p.followUp, test);
  const round = p.round ? `${p.round}회차` : '이번 회차';
  return (
    `[이벤트: ${recurringEventType(test)}]\n` +
    (test
      ? `반복 작업을 「지금 실행」으로 한 번 시험해 보는 테스트 실행입니다. 실행 시각: ${formatKst(p.runAt)}\n`
      : `반복 작업의 ${round} 실행입니다. 실행 시각: ${formatKst(p.runAt)}\n`) +
    recurringIssueLines(p) +
    (p.actor ? `요청자: @${p.actor.username}\n` : '') +
    `\n## 이슈 본문 (이번 회차에 할 일)\n${recurringBody(p)}\n\n` +
    `## 이번 회차 규칙\n` +
    `- 이슈 본문이 요청한 일을 이번 회차(${formatKst(p.runAt)}) 기준으로 수행하세요. 본문이 시킨 쓰기(메일 보내기, 이슈·일정 만들기·고치기 등)는 확인 카드 없이 바로 합니다. 본문에 없는 쓰기는 하지 말고 결과 끝의 「제안」 절에 적습니다.\n` +
    `- 본문이 쓰기 전에 확인을 받으라고 하면 그 쓰기를 하지 말고, 최종 답변 첫 줄을 \`${RECURRING_QUESTION_MARKER}\` 로 시작해 하려는 일과 확인받을 내용을 적으세요. 그 밖에는 질문하지 않습니다.\n` +
    (test ? testRunRule() : '') +
    ownerToolsRule(p) +
    chatResultRule('이번 회차 결과', '결과만')
  );
}

// WP-1219: 담당 지정·생성 실행의 지시. 예전 지시는 「상태를 진행 중으로 바꾸고 시작 코멘트」에서 끝나, 모델이 「작업을 시작합니다 … 공유하겠습니다」 코멘트만
// 남기고 실행을 끝냈다(사람이 다시 코멘트해야 결과가 나왔다). 이 실행 하나가 맡은 일 전부라는 것과 끝에 남길 결과를 분명히 한다.
const DO_THE_WORK =
  `get_issue_detail 로 본문·코멘트를 읽고 이 이슈가 요청한 일을 이번 실행 안에서 끝까지 하세요. 이 실행이 끝나면 다시 깨어나지 않습니다 — 「시작합니다」·「곧 공유하겠습니다」만 남기고 끝내지 않습니다.\n` +
  `1. 시작할 때 update_issue 의 status 를 'IN_PROGRESS' 로 바꿉니다(결과의 ok 가 false 이거나 results.content 가 'failed' 로 시작하면 상태가 바뀌지 않은 것이므로 결과 코멘트에 실패를 함께 적습니다). 시작 코멘트는 따로 남기지 않습니다.\n` +
  `2. 요청한 결과물(체크리스트·정리·초안·답 등)을 만들어 add_comment 로 남깁니다 — 결과 코멘트 하나에 결과 전체를 마크다운으로 담습니다.\n` +
  `3. 정보가 모자라거나 권한·도구가 없어 끝낼 수 없으면, 한 데까지의 결과와 끝내지 못한 이유·필요한 것을 코멘트로 남깁니다.`;

export function buildUserMessage(env: IssueEventEnvelope): string {
  switch (env.type) {
    case 'issue.created': {
      const p = env.payload;
      return (
        `[이벤트: issue.created]\n` +
        `이슈가 새로 생성됐고 당신이 담당자입니다.\n` +
        `이슈키: ${p.issueKey}\n` +
        `제목: ${p.issueTitle}\n` +
        `생성자: @${p.actor.username}\n\n` +
        // WP-1219: 방향만 알리고 끝내지 않게 — 맡은 일을 이번 실행 안에서 끝내 결과를 남기게 한다(issue.assigned 와 같은 지시).
        DO_THE_WORK
      );
    }
    case 'issue.assigned': {
      const p = env.payload;
      return (
        `[이벤트: issue.assigned]\n` +
        `당신이 이 이슈의 담당자로 지정됐습니다.\n` +
        `이슈키: ${p.issueKey}\n` +
        `제목: ${p.issueTitle}\n` +
        `지정자: @${p.actor.username}\n\n` +
        DO_THE_WORK
      );
    }
    case 'issue.commented': {
      const p = env.payload;
      return (
        `[이벤트: issue.commented]\n` +
        `담당한 이슈에 사용자가 코멘트를 남겼습니다.\n` +
        `이슈키: ${p.issueKey}\n` +
        `작성자: @${p.actor.username} (${p.actor.kind})\n` +
        `코멘트: "${p.commentBody}"\n\n` +
        `적절히 응답. 추가 컨텍스트 필요시 get_issue_detail.`
      );
    }
    case 'issue.status_changed': {
      const p = env.payload;
      // WP-807: 상태 이름이 오면 "이름(범주)" 로 보여 준다 — 이름이 없는 구 페이로드는 범주만.
      const label = (category: string, name?: string | null) => (name ? `${name}(${category})` : category);
      return (
        `[이벤트: issue.status_changed]\n` +
        `담당한 이슈의 상태가 변경됐습니다: ${label(p.previousStatus, p.previousStatusName)} → ${label(p.newStatus, p.newStatusName)} (by @${p.actor.username}).\n` +
        `이슈키: ${p.issueKey}\n\n` +
        `필요한 대응이 있으면 진행. 단순 알림이면 무시.`
      );
    }
    case 'issue.recurring_run':
      return buildRecurringRunMessage(env.payload);
    case 'issue.recurring_test_run':
      return buildRecurringRunMessage(env.payload, { test: true });
  }
}
