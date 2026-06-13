// 개인 작업 우측 비모달 drawer — ?task=N 이 있을 때만 슬라이드인. dim 없음(목록 계속 클릭 가능).
// 기존 필드 위젯 + 이슈 chat 재사용. ESC·✕·같은 행 재클릭으로 닫힘.
import { X } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { LabelChip } from '@/components/labels/LabelChip';
import { LabelPickerPopover } from '@/components/labels/LabelPickerPopover';
import { Button } from '@/components/ui/button';
import { useIssue, useUpdateIssue } from '@/hooks/queries/useIssue';
import { cn } from '@/lib/utils';

import { AssigneePickerPopover } from '../components/AssigneePickerPopover';
import { IssueChatSection } from '../components/chat/IssueChatSection';
import { IssuePrioritySelect } from '../components/IssuePrioritySelect';
import { IssueStatusSelect } from '../components/IssueStatusSelect';

/** ?task=N 쿼리 파라미터를 감지해 비모달 우측 drawer를 열거나 닫는다. */
export function PersonalTaskPanel({ projectKey }: { projectKey: string }) {
  const [params, setParams] = useSearchParams();
  const taskParam = params.get('task');
  const number = taskParam ? Number(taskParam) : NaN;
  const open = Number.isFinite(number);

  // 닫기 — task 쿼리 제거, 나머지(view 등) 유지.
  const close = useCallback(
    () => setParams((p) => { const n = new URLSearchParams(p); n.delete('task'); return n; }, { replace: true }),
    [setParams],
  );

  // ESC 로 닫기.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // 비모달 떠 있는 우측 drawer — dim 배경 없음(목록 계속 클릭 가능). 닫힘 시 화면 밖으로 슬라이드 + pointer-events 차단.
  return (
    <div
      role="complementary"
      aria-label="작업 상세"
      aria-hidden={!open}
      data-testid={open ? 'personal-task-panel' : undefined}
      className={cn(
        'fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col border-l bg-card shadow-xl transition-transform duration-200',
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
      )}
    >
      {open && <PanelBody key={number} projectKey={projectKey} number={number} onClose={close} />}
    </div>
  );
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
    // 스크롤 컨테이너 — 외부 wrapper가 h-full flex flex-col이므로 flex-1로 남은 높이 채움.
    <div className="flex flex-1 flex-col overflow-y-auto">
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
    </div>
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
