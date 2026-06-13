// 개인 작업 상세 — 뷰별 하이브리드: 리스트/체크리스트=인플로우 사이드 패널, 보드=중앙 모달(#231).
// ?task=N 이 있을 때만 표시. 기존 필드 위젯 + 이슈 chat 재사용. ESC·✕·같은 행 재클릭으로 닫힘.
import { X } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { LabelChip } from '@/components/labels/LabelChip';
import { LabelPickerPopover } from '@/components/labels/LabelPickerPopover';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useIssue, useUpdateIssue } from '@/hooks/queries/useIssue';
import { cn } from '@/lib/utils';

import { AssigneePickerPopover } from '../components/AssigneePickerPopover';
import { IssueChatSection } from '../components/chat/IssueChatSection';
import { IssuePrioritySelect } from '../components/IssuePrioritySelect';
import { IssueStatusSelect } from '../components/IssueStatusSelect';

/**
 * ?task=N 쿼리 파라미터를 감지해 상세를 연다.
 * - panel 모드(리스트/체크리스트): 콘텐츠를 밀어 공존하는 인플로우 사이드 패널(툴바 비가림).
 * - modal 모드(보드): 칸반 가로폭 보존을 위해 중앙 모달(Radix Dialog).
 */
export function PersonalTaskPanel({
  projectKey,
  mode,
}: {
  projectKey: string;
  mode: 'panel' | 'modal';
}) {
  const [params, setParams] = useSearchParams();
  const taskParam = params.get('task');
  const number = taskParam ? Number(taskParam) : NaN;
  const open = Number.isFinite(number);

  // 닫기 — task 쿼리 제거, 나머지(view 등) 유지.
  const close = useCallback(
    () => setParams((p) => { const n = new URLSearchParams(p); n.delete('task'); return n; }, { replace: true }),
    [setParams],
  );

  // ESC 로 닫기 — panel 모드 한정(modal 은 Radix Dialog 가 ESC 처리).
  useEffect(() => {
    if (!open || mode === 'modal') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, mode, close]);

  // 보드 뷰 → 중앙 모달(dim·ESC·외부클릭 닫기는 Radix). 칸반 가로폭 보존.
  if (mode === 'modal') {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent
          data-testid="personal-task-modal"
          className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px]"
        >
          {/* Radix a11y — DialogContent 에 설명 필수(없으면 콘솔 경고). 화면엔 숨김. */}
          <DialogDescription className="sr-only">작업 상세 보기</DialogDescription>
          {open && <PersonalTaskDetail key={number} projectKey={projectKey} number={number} onClose={close} asModal />}
        </DialogContent>
      </Dialog>
    );
  }

  // 리스트·체크리스트 뷰 → 인플로우 사이드 패널. md+ 는 콘텐츠를 밀어 공존(툴바 비가림),
  // < md 는 좁은 화면 보호용 fixed 오버레이. dim 없음(목록 계속 클릭 가능). 닫힘 시 미렌더.
  if (!open) return null;
  return (
    <aside
      role="complementary"
      aria-label="작업 상세"
      data-testid="personal-task-panel"
      className={cn(
        'flex min-h-0 flex-col border-l bg-card',
        'max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-50 max-md:w-full max-md:max-w-[400px] max-md:shadow-xl',
        'md:relative md:w-[400px] md:shrink-0',
      )}
    >
      <PersonalTaskDetail key={number} projectKey={projectKey} number={number} onClose={close} />
    </aside>
  );
}

/** 실제 이슈 단건 로드 및 필드 렌더. asModal=true 면 헤더 제목을 DialogTitle 로(Radix a11y), 닫기 버튼은 DialogContent 자체 사용. */
export function PersonalTaskDetail({
  projectKey,
  number,
  onClose,
  asModal,
}: {
  projectKey: string;
  number: number;
  onClose: () => void;
  asModal?: boolean;
}) {
  const q = useIssue(projectKey, number);
  const update = useUpdateIssue(projectKey, number);

  return (
    // 스크롤 컨테이너 — 외부 wrapper가 h-full flex flex-col이므로 flex-1로 남은 높이 채움.
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* 헤더 — 제목 + (패널일 때만) 닫기 버튼. 모달은 DialogContent 자체 닫기 사용. */}
      <div className="flex items-center justify-between border-b p-3">
        {asModal ? (
          <DialogTitle className="truncate text-sm font-medium">
            {q.data?.summary.title ?? '작업'}
          </DialogTitle>
        ) : (
          <span className="truncate text-sm font-medium">{q.data?.summary.title ?? '작업'}</span>
        )}
        {!asModal && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="닫기"
            data-testid="personal-task-panel-close"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
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
