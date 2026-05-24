// 이슈 변경 이력 타임라인. status/priority/assignee/dueDate/title/labels 변경 기록.

import type { IssueHistoryEntry, IssueHistoryEventType } from '../../../types/issue';

// 이벤트 타입을 한국어 라벨로 매핑 — 백엔드 enum 과 1:1 매칭.
const EVENT_LABEL: Record<IssueHistoryEventType, string> = {
  TITLE_CHANGED: '제목 변경',
  STATUS_CHANGED: '상태 변경',
  PRIORITY_CHANGED: '우선순위 변경',
  ASSIGNEE_CHANGED: '담당자 변경',
  ASSIGNEES_CHANGED: '담당자 변경',
  DUE_DATE_CHANGED: '마감일 변경',
  LABELS_CHANGED: '라벨 변경',
  ATTACHMENTS_CHANGED: '첨부 변경',
  TYPE_CHANGED: '유형 변경',
  PARENT_CHANGED: '부모 변경',
};

// LABELS_CHANGED 페이로드는 toValue 에 {added:[{name,...}], removed:[{name,...}]} JSON 으로 들어온다.
// 파싱 실패 시 원문 그대로 노출.
function formatLabelsChanged(toValue: string | null): string {
  if (!toValue) return '없음';
  try {
    const parsed = JSON.parse(toValue) as {
      added?: { name?: string }[];
      removed?: { name?: string }[];
    };
    const added = (parsed.added ?? []).map((l) => l.name ?? '').filter(Boolean);
    const removed = (parsed.removed ?? []).map((l) => l.name ?? '').filter(Boolean);
    const parts: string[] = [];
    if (added.length) parts.push(`+ ${added.join(', ')}`);
    if (removed.length) parts.push(`- ${removed.join(', ')}`);
    return parts.length ? parts.join(' / ') : '변경 없음';
  } catch {
    return toValue;
  }
}

// ATTACHMENTS_CHANGED 페이로드는 toValue 에 {added:[{fileId,originalName}], removed:[{fileId,originalName}]} JSON.
// 라벨과 동일 패턴으로 파싱해 +/- 로 표시. 파싱 실패 시 안전한 기본 문구로 폴백.
function formatAttachmentsChanged(toValue: string | null): string {
  if (!toValue) return '첨부 변경';
  try {
    const parsed = JSON.parse(toValue) as {
      added?: { originalName?: string }[];
      removed?: { originalName?: string }[];
    };
    const added = (parsed.added ?? []).map((x) => x.originalName ?? '').filter(Boolean);
    const removed = (parsed.removed ?? []).map((x) => x.originalName ?? '').filter(Boolean);
    const parts: string[] = [];
    if (added.length) parts.push(`+ ${added.join(', ')}`);
    if (removed.length) parts.push(`- ${removed.join(', ')}`);
    return parts.length ? parts.join(' / ') : '변경 없음';
  } catch {
    return toValue;
  }
}

// ASSIGNEES_CHANGED 페이로드는 toValue 에 {added:[{id,name,...}], removed:[{id,name,...}]} JSON.
// name 이 비어 있을 수 있어 (removed 의 경우) #id 로 폴백.
function formatAssigneesChanged(toValue: string | null): string {
  if (!toValue) return '담당자 변경';
  try {
    const parsed = JSON.parse(toValue) as {
      added?: { id: number; name?: string | null }[];
      removed?: { id: number; name?: string | null }[];
    };
    const added = (parsed.added ?? []).map((x) => x.name ?? `#${x.id}`);
    const removed = (parsed.removed ?? []).map((x) => x.name ?? `#${x.id}`);
    const parts: string[] = [];
    if (added.length) parts.push(`+ ${added.join(', ')}`);
    if (removed.length) parts.push(`- ${removed.join(', ')}`);
    return parts.length ? parts.join(' / ') : '변경 없음';
  } catch {
    return toValue;
  }
}

// PARENT_CHANGED 페이로드는 toValue 에 {from:{number,title}|null, to:{number,title}|null} JSON.
// 백엔드가 parent type 은 보내지 않으므로 텍스트만 렌더 — 설정/해제/변경을 자연어로 표기.
function formatParentChanged(toValue: string | null): string {
  if (!toValue) return '부모 변경';
  try {
    const p = JSON.parse(toValue) as {
      from?: { number: number; title: string } | null;
      to?: { number: number; title: string } | null;
    };
    const from = p.from ?? null;
    const to = p.to ?? null;
    if (to == null && from == null) return '부모 변경';
    if (to == null) return `부모 해제 (이전 ${from?.title ?? ''})`;
    if (from == null) return `부모 ${to.title} 로 설정`;
    return `${from.title} → ${to.title}`;
  } catch {
    return toValue;
  }
}

// TYPE_CHANGED 페이로드는 toValue 에 {from:{id,name}, to:{id,name}} JSON.
// 파싱 실패 시 안전한 기본 문구로 폴백.
function formatTypeChanged(toValue: string | null): string {
  if (!toValue) return '유형 변경';
  try {
    const p = JSON.parse(toValue) as {
      from?: { name?: string };
      to?: { name?: string };
    };
    return `${p.from?.name ?? '?'} → ${p.to?.name ?? '?'}`;
  } catch {
    return toValue;
  }
}

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
            {e.eventType === 'LABELS_CHANGED' ? (
              <span>{formatLabelsChanged(e.toValue)}</span>
            ) : e.eventType === 'ATTACHMENTS_CHANGED' ? (
              <span>{formatAttachmentsChanged(e.toValue)}</span>
            ) : e.eventType === 'ASSIGNEES_CHANGED' ? (
              <span>{formatAssigneesChanged(e.toValue)}</span>
            ) : e.eventType === 'TYPE_CHANGED' ? (
              <span>{formatTypeChanged(e.toValue)}</span>
            ) : e.eventType === 'PARENT_CHANGED' ? (
              <span>{formatParentChanged(e.toValue)}</span>
            ) : (
              <span>
                {e.fromValue ?? '없음'} → {e.toValue ?? '없음'}
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
