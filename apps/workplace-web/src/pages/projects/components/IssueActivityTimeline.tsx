// 이슈 변경 이력 타임라인. status/priority/assignee/dueDate/title 변경만 기록.

import type { IssueHistoryEntry, IssueHistoryEventType } from '../../../types/issue';

// 이벤트 타입을 한국어 라벨로 매핑 — 백엔드 enum 과 1:1 매칭.
const EVENT_LABEL: Record<IssueHistoryEventType, string> = {
  TITLE_CHANGED: '제목 변경',
  STATUS_CHANGED: '상태 변경',
  PRIORITY_CHANGED: '우선순위 변경',
  ASSIGNEE_CHANGED: '담당자 변경',
  DUE_DATE_CHANGED: '마감일 변경',
};

// 이력 항목을 시간순으로 ol 로 렌더. fromValue/toValue 가 null 이면 '없음' 으로 표시.
export function IssueActivityTimeline({ entries }: { entries: IssueHistoryEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">변경 이력 없음</p>;
  }
  return (
    <ol className="space-y-2 text-sm" role="list" aria-label="활동 타임라인">
      {entries.map((e) => (
        <li key={e.id} className="border-l-2 pl-3">
          <div className="text-muted-foreground">
            {e.actorName} · {new Date(e.createdAt).toLocaleString('ko-KR')}
          </div>
          <div>
            <span className="font-medium">{EVENT_LABEL[e.eventType]}</span>:{' '}
            <span>{e.fromValue ?? '없음'} → {e.toValue ?? '없음'}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
