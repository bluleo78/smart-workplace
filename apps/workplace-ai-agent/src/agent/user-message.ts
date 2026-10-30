// 4 type envelope → Claude CLI 에 넘길 user message 문자열 변환.
// spec §"Type 별 user message" 와 일치.
import type { IssueEventEnvelope, IssueRecurringRunPayload } from '../types/issue-events.js';

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

// WP-989: 반복 개인 작업의 회차 실행 지시문. 도구는 등록한 사람 권한으로 돈다. 사람이 지켜보지 않는 실행이라 확인 카드를 띄울 수 없으므로
// 쓰기는 하지 않고(도구도 읽기만 싣는다) 필요한 쓰기는 결과의 「제안」으로 적게 한다. 최종 답변이 그대로 이슈 챗에 올라간다.
export function buildRecurringRunMessage(p: IssueRecurringRunPayload): string {
  const round = p.round ? `${p.round}회차` : '이번 회차';
  const body = p.issueBody?.trim() ? p.issueBody.trim() : '(본문 없음 — 제목을 보고 할 일을 판단하세요)';
  return (
    `[이벤트: issue.recurring_run]\n` +
    `반복 개인 작업의 ${round} 실행입니다. 실행 시각: ${formatKst(p.runAt)}\n` +
    `이슈키: ${p.issueKey}\n` +
    `제목: ${p.issueTitle}\n` +
    `반복: ${p.recurrence.rrule} · ${p.recurrence.time} KST\n` +
    (p.actor ? `요청자: @${p.actor.username}\n` : '') +
    `\n## 이슈 본문 (이번 회차에 할 일)\n${body}\n\n` +
    `## 이번 회차 규칙\n` +
    `- 이슈 본문이 요청한 일을 이번 회차(${formatKst(p.runAt)}) 기준으로 수행하세요. 필요한 정보는 읽기 도구로 조회합니다.\n` +
    `- 쓰기 작업(메일 보내기, 이슈·일정 만들기·고치기, 메시지·코멘트 남기기 등)은 하지 마세요. 쓰기가 필요해 보이면 결과 끝의 「제안」 절에 무엇을 왜 하면 좋을지 적습니다.\n` +
    `- 도구는 요청자(@${p.actor?.username ?? '등록한 사람'})의 권한으로 동작합니다 — 그 사람의 메일·일정·노트·이슈 등을 직접 조회하세요. 사람이 지켜보지 않는 실행이라 질문하지 않습니다.\n` +
    `- 최종 답변이 그대로 이슈 챗에 남는 이번 회차 결과입니다. 인사·과정 설명 없이 결과만 간결한 한국어 마크다운으로 쓰세요.`
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
  }
}
