// 이슈 변경 이력 타임라인. status/priority/assignee/dueDate/title/labels 변경 기록.

import {
  AlertTriangle,
  Calendar,
  GitBranch,
  GitFork,
  Layers,
  Link,
  Link2Off,
  type LucideIcon,
  Paperclip,
  Pencil,
  SlidersHorizontal,
  Tag,
  User,
  Users,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';

import { formatDateTimeMinute } from '../../../lib/formatters';
import type { IssueHistoryEntry, IssueHistoryEventType } from '../../../types/issue';

// 이벤트 타입별 Lucide 아이콘 매핑 — 타임라인 스캔 가독성 향상 (#313).
const EVENT_ICON: Record<IssueHistoryEventType, LucideIcon> = {
  TITLE_CHANGED: Pencil,
  STATUS_CHANGED: GitBranch,
  PRIORITY_CHANGED: AlertTriangle,
  ASSIGNEE_CHANGED: User,
  ASSIGNEES_CHANGED: Users,
  DUE_DATE_CHANGED: Calendar,
  LABELS_CHANGED: Tag,
  ATTACHMENTS_CHANGED: Paperclip,
  TYPE_CHANGED: Layers,
  PARENT_CHANGED: GitFork,
  DEPENDENCY_ADDED: Link,
  DEPENDENCY_REMOVED: Link2Off,
  CUSTOM_FIELD_CHANGED: SlidersHorizontal,
};

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
  DEPENDENCY_ADDED: '의존성 추가',
  DEPENDENCY_REMOVED: '의존성 제거',
  CUSTOM_FIELD_CHANGED: '필드',
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

// DEPENDENCY_ADDED/REMOVED 페이로드는 toValue 에
// {other:{number,title}, direction:"blocks"|"blockedBy"} JSON 으로 들어온다.
// direction 토큰을 한국어 보조 텍스트로 변환해 출력.
function formatDependencyChanged(
  toValue: string | null,
  eventType: 'DEPENDENCY_ADDED' | 'DEPENDENCY_REMOVED',
): string {
  const verb = eventType === 'DEPENDENCY_ADDED' ? '추가' : '제거';
  if (!toValue) return verb;
  try {
    const p = JSON.parse(toValue) as {
      other?: { number: number; title: string };
      direction?: string;
    };
    const dirLabel = p.direction === 'blockedBy' ? '차단됨' : '차단 중';
    const otherText = p.other?.title ?? `#${p.other?.number ?? ''}`;
    return `${otherText} (${dirLabel}) ${verb}`;
  } catch {
    return toValue;
  }
}

// CUSTOM_FIELD_CHANGED 페이로드는 toValue 에 {defId,name,type,from,to} JSON.
// from/to 는 type 별 모양이 다르므로 (string|number|string[]) 안전한 fmt 로 표시.
function formatCustomFieldChanged(toValue: string | null): string {
  if (!toValue) return '필드 변경';
  try {
    const p = JSON.parse(toValue) as {
      name?: string;
      type?: string;
      from?: unknown;
      to?: unknown;
    };
    const fmt = (v: unknown): string => {
      if (v == null) return '(빈값)';
      if (Array.isArray(v)) return v.join(', ');
      return String(v);
    };
    return `${p.name ?? '?'}: ${fmt(p.from)} → ${fmt(p.to)}`;
  } catch {
    return toValue;
  }
}

// STATUS_CHANGED: 백엔드 enum → 한국어 상태명. 매핑 없는 값은 원문 폴백.
const STATUS_LABEL: Record<string, string> = {
  TODO: '할 일',
  IN_PROGRESS: '진행 중',
  DONE: '완료',
  CANCELED: '취소',
};

// PRIORITY_CHANGED: 백엔드 enum → 한국어 우선순위명. 매핑 없는 값은 원문 폴백.
const PRIORITY_LABEL: Record<string, string> = {
  HIGH: '높음',
  MID: '보통',
  LOW: '낮음',
};

function mapStatusLabel(v: string | null): string {
  if (!v) return '없음';
  return STATUS_LABEL[v] ?? v;
}

function mapPriorityLabel(v: string | null): string {
  if (!v) return '없음';
  return PRIORITY_LABEL[v] ?? v;
}

// 접기 기본값: 최근 5건만 표시. "이전 N건 더 보기" 토글로 전체 펼침 (#341).
const MAX_VISIBLE = 5;

// 이력 항목을 시간순으로 ol 로 렌더. fromValue/toValue 가 null 이면 '없음' 으로 표시.
export function IssueActivityTimeline({ entries }: { entries: IssueHistoryEntry[] }) {
  // showAll: 전체 보기 여부. 기본은 최근 MAX_VISIBLE 건만 표시.
  const [showAll, setShowAll] = useState(false);

  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">변경 이력 없음</p>;
  }

  // 최신 항목이 마지막에 있으므로 slice(-MAX_VISIBLE)로 최근 항목 추출
  const visible = showAll ? entries : entries.slice(-MAX_VISIBLE);
  const hiddenCount = entries.length - MAX_VISIBLE;

  return (
    <div className="space-y-2" data-testid="issue-activity-timeline">
      {/* MAX_VISIBLE 초과 시 "이전 N건 더 보기" 토글 버튼 — 상단 배치로 더 오래된 항목 접기 */}
      {!showAll && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="text-muted-foreground hover:text-foreground w-full text-center text-xs underline-offset-2 hover:underline"
          aria-label={`이전 ${hiddenCount}건 활동 더 보기`}
        >
          이전 {hiddenCount}건 더 보기
        </button>
      )}
      <ol className="space-y-2 text-sm" role="list" aria-label="활동 타임라인">
        {visible.map((e) => {
        const isAgent = e.actorKind === 'AGENT';
        return (
          <li
            key={e.id}
            className={
              // AGENT: 보라색 ai-accent 보더, HUMAN: 기본 border 색상으로 명시적 지정
              isAgent ? 'border-l-2 border-l-ai-accent pl-3' : 'border-l-2 border-l-border pl-3'
            }
            data-agent={isAgent ? 'true' : undefined}
          >
            <div className="flex items-start gap-2">
              {/* 이벤트 유형별 아이콘 — 타임라인 스캔 가독성 향상 (#313) */}
              {(() => {
                const Icon = EVENT_ICON[e.eventType];
                return (
                  <Icon
                    className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                );
              })()}
              <div className="min-w-0 flex-1">
                <div className="text-muted-foreground flex items-center gap-1">
                  <span>{e.actorName}</span>
                  {isAgent && (
                    <Badge
                      variant="secondary"
                      className="bg-ai-accent-subtle text-ai-accent"
                    >
                      AI
                    </Badge>
                  )}
                  {/* parseUtcDate 내장 formatDateTimeMinute 로 UTC→로컬 변환 + 분 단위 (#320) */}
                  <span>· {formatDateTimeMinute(e.createdAt)}</span>
                </div>
                <div>
                  <span className="font-medium">{EVENT_LABEL[e.eventType]}</span>:{' '}
                  {e.eventType === 'STATUS_CHANGED' ? (
                    <span>
                      {mapStatusLabel(e.fromValue)} → {mapStatusLabel(e.toValue)}
                    </span>
                  ) : e.eventType === 'PRIORITY_CHANGED' ? (
                    <span>
                      {mapPriorityLabel(e.fromValue)} → {mapPriorityLabel(e.toValue)}
                    </span>
                  ) : e.eventType === 'LABELS_CHANGED' ? (
                    <span>{formatLabelsChanged(e.toValue)}</span>
                  ) : e.eventType === 'ATTACHMENTS_CHANGED' ? (
                    <span>{formatAttachmentsChanged(e.toValue)}</span>
                  ) : e.eventType === 'ASSIGNEES_CHANGED' ? (
                    <span>{formatAssigneesChanged(e.toValue)}</span>
                  ) : e.eventType === 'TYPE_CHANGED' ? (
                    <span>{formatTypeChanged(e.toValue)}</span>
                  ) : e.eventType === 'PARENT_CHANGED' ? (
                    <span>{formatParentChanged(e.toValue)}</span>
                  ) : e.eventType === 'DEPENDENCY_ADDED' ? (
                    <span>{formatDependencyChanged(e.toValue, 'DEPENDENCY_ADDED')}</span>
                  ) : e.eventType === 'DEPENDENCY_REMOVED' ? (
                    <span>{formatDependencyChanged(e.toValue, 'DEPENDENCY_REMOVED')}</span>
                  ) : e.eventType === 'CUSTOM_FIELD_CHANGED' ? (
                    <span>{formatCustomFieldChanged(e.toValue)}</span>
                  ) : (
                    <span>
                      {e.fromValue ?? '없음'} → {e.toValue ?? '없음'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
      {/* 전체 펼친 상태에서 "접기" 버튼 — 다시 최근 N건으로 축소 */}
      {showAll && hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowAll(false)}
          className="text-muted-foreground hover:text-foreground w-full text-center text-xs underline-offset-2 hover:underline"
          aria-label="활동 이력 접기"
        >
          접기
        </button>
      )}
    </div>
  );
}
