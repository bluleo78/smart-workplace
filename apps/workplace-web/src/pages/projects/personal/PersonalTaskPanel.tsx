// 개인 작업 우측 상세 패널 — ?task=N 이 있을 때만 표시. 기존 필드 위젯 + 이슈 chat 재사용.
// 노출 필드: 상태·우선순위·마감·담당자·라벨·메모(읽기)·AI 대화. 제거: 사이클·의존성·커스텀필드·watch·활동.
import { X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import { LabelChip } from '@/components/labels/LabelChip';
import { LabelPickerPopover } from '@/components/labels/LabelPickerPopover';
import { Button } from '@/components/ui/button';
import { useIssue, useUpdateIssue } from '@/hooks/queries/useIssue';

import { AssigneePickerPopover } from '../components/AssigneePickerPopover';
import { IssueChatSection } from '../components/chat/IssueChatSection';
import { IssuePrioritySelect } from '../components/IssuePrioritySelect';
import { IssueStatusSelect } from '../components/IssueStatusSelect';

/** ?task=N 쿼리 파라미터를 감지해 우측 패널을 열거나 숨긴다. */
export function PersonalTaskPanel({ projectKey }: { projectKey: string }) {
  const [params, setParams] = useSearchParams();
  const taskParam = params.get('task');
  const number = taskParam ? Number(taskParam) : NaN;
  const open = Number.isFinite(number);

  // 패널 닫기 — task 쿼리만 제거, 나머지 쿼리(view 등) 유지.
  const close = () =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.delete('task');
        return n;
      },
      { replace: true },
    );

  if (!open) return null;
  // number 변경 시 key 로 재마운트 → 이전 이슈 캐시 UI 잔류 방지.
  return <PanelBody key={number} projectKey={projectKey} number={number} onClose={close} />;
}

/** 실제 이슈 단건 로드 및 필드 렌더. */
function PanelBody({
  projectKey,
  number,
  onClose,
}: {
  projectKey: string;
  number: number;
  onClose: () => void;
}) {
  const q = useIssue(projectKey, number);
  const update = useUpdateIssue(projectKey, number);

  return (
    <aside
      data-testid="personal-task-panel"
      aria-label="작업 상세"
      className="flex w-[380px] min-w-0 shrink-0 flex-col overflow-y-auto border-l bg-card"
    >
      {/* 헤더 — 제목 + 닫기 버튼 */}
      <div className="flex items-center justify-between border-b p-3">
        <span className="truncate text-sm font-medium">{q.data?.summary.title ?? '작업'}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="닫기"
          data-testid="personal-task-panel-close"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* 로딩 중 */}
      {q.isLoading && <p className="p-4 text-sm text-muted-foreground">로딩 중…</p>}

      {/* 에러 / 찾을 수 없음 */}
      {q.error && (
        <div data-testid="personal-task-panel-notfound" className="p-4 text-sm text-destructive">
          작업을 찾을 수 없습니다.
          <button type="button" onClick={onClose} className="ml-2 underline">
            닫기
          </button>
        </div>
      )}

      {/* 필드 영역 — 필드 다이어트: 상태·우선순위·마감·담당자·라벨·메모·AI대화만 */}
      {q.data && (
        <div className="space-y-4 p-4">
          <Field label="상태">
            <IssueStatusSelect
              value={q.data.summary.status}
              disabled={update.isPending}
              onChange={(v) => update.mutate({ status: v })}
            />
          </Field>
          <Field label="우선순위">
            <IssuePrioritySelect
              value={q.data.summary.priority}
              disabled={update.isPending}
              onChange={(v) => update.mutate({ priority: v })}
            />
          </Field>
          <Field label="마감">
            <input
              type="date"
              value={q.data.summary.dueDate ?? ''}
              disabled={update.isPending}
              onChange={(e) =>
                update.mutate(e.target.value ? { dueDate: e.target.value } : { clearDueDate: true })
              }
              className="rounded border bg-background px-2 py-1 text-sm"
            />
          </Field>
          <Field label="담당자">
            <AssigneePickerPopover
              projectKey={projectKey}
              issueNumber={number}
              current={q.data.summary.assignees}
            />
          </Field>
          <Field label="라벨">
            <div className="flex flex-wrap items-center gap-1">
              {q.data.summary.labels.map((l) => (
                <LabelChip key={l.id} label={l} size="sm" />
              ))}
              <LabelPickerPopover
                projectKey={projectKey}
                issueNumber={number}
                current={q.data.summary.labels}
              />
            </div>
          </Field>
          <Field label="메모">
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {q.data.body || '본문 없음'}
            </p>
          </Field>

          {/* AI 위임 대화 = 기존 이슈 chat 스레드 재사용. 사이클·의존성·커스텀필드·watch 미포함. */}
          <div data-testid="personal-panel-chat">
            <IssueChatSection projectKey={projectKey} issueNumber={number} />
          </div>
        </div>
      )}
    </aside>
  );
}

/** 라벨 + 값 한 줄 레이아웃. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
