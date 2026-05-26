// 4 type envelope → Claude CLI 에 넘길 user message 문자열 변환.
// spec §"Type 별 user message" 와 일치.
import type { IssueEventEnvelope } from '../types/issue-events.js';

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
        `필요시 get_issue_detail 로 본문을 확인하고 작업 방향을 코멘트로 알려주세요.`
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
        `get_issue_detail 로 컨텍스트 파악 후 작업 시작. update_status('IN_PROGRESS') 와 시작 코멘트.`
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
      return (
        `[이벤트: issue.status_changed]\n` +
        `담당한 이슈의 상태가 변경됐습니다: ${p.previousStatus} → ${p.newStatus} (by @${p.actor.username}).\n` +
        `이슈키: ${p.issueKey}\n\n` +
        `필요한 대응이 있으면 진행. 단순 알림이면 무시.`
      );
    }
  }
}
