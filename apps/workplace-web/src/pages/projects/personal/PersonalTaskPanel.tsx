// 개인 작업 상세 — 뷰별 하이브리드: 리스트/체크리스트=인플로우 사이드 패널, 보드=중앙 모달(#231).
// ?task=N 이 있을 때만 표시. 기존 필드 위젯 + 이슈 chat 재사용. ESC·✕·같은 행 재클릭으로 닫힘.
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { LabelChip } from '@/components/labels/LabelChip';
import { LabelPickerPopover } from '@/components/labels/LabelPickerPopover';
import { pageGutterClass, subPaneHeaderClass } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useHistoryParam } from '@/hooks/useHistoryParam';
import { useIsMobile } from '@/hooks/useIsMobile';
import { parseId } from '@/lib/historyParam';
import { cn } from '@/lib/utils';

import { AssigneePickerPopover } from '../components/AssigneePickerPopover';
import { IssueChatSection } from '../components/chat/IssueChatSection';
import { InlineEditableTitle } from '../components/InlineEditableTitle';
import { IssuePrioritySelect } from '../components/IssuePrioritySelect';
import { IssueStatusSelect } from '../components/IssueStatusSelect';
import { PersonalTaskMobile } from './PersonalTaskMobile';
import { usePersonalTask } from './usePersonalTask';

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
  // ?task=N — 열림의 단일 원천. 닫기(✕·ESC·바깥 클릭·같은 행 재클릭)는 공용 히스토리 닫기:
  // 리스트 행이 push 로 연 항목은 되돌리고, 보드 카드 Link·리다이렉트로 들어온 항목은 출발 화면으로,
  // 콜드 딥링크는 task 만 지운다(WP-208).
  const taskParam = useHistoryParam('task');
  const number = parseId(taskParam.value);
  const isMobile = useIsMobile();

  // 모바일(<1024px) — 모드(보드 모달/리스트 패널)와 무관하게 전체 화면 상세(WP-221). 768~1023px 에서 400px 패널이
  // 콘텐츠를 짓누르던 문제도 이 분기로 해소된다. 데스크톱은 기존 모달/패널 그대로.
  return isMobile ? (
    <PersonalTaskMobile projectKey={projectKey} number={number} onClose={taskParam.close} />
  ) : (
    <PersonalTaskPanelDesktop projectKey={projectKey} mode={mode} number={number} close={taskParam.close} />
  );
}

/** 데스크톱 상세 — 보드=중앙 모달, 리스트·체크리스트=인플로우 사이드 패널. 열림 판단은 상위의 number. */
function PersonalTaskPanelDesktop({
  projectKey,
  mode,
  number,
  close,
}: {
  projectKey: string;
  mode: 'panel' | 'modal';
  number: number | null;
  close: () => void;
}) {
  const open = number != null;

  // ESC 로 닫기 — panel 모드 한정(modal 은 Radix Dialog 가 ESC 처리 — 이중 닫기 방지).
  useEffect(() => {
    if (!open || mode === 'modal') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, mode, close]);

  // 포커스 관리 — panel 모드는 Radix Dialog 를 쓰지 않아 열림/닫힘 시 포커스 이동이
  // 전혀 없었다(#817). 열릴 때 패널 컨테이너로 포커스를 옮기고, 닫힐 때(트리거 재클릭/ESC/✕
  // 무엇이든) 열기 직전 포커스였던 요소로 복귀한다.
  const asideRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open || mode === 'modal') return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    asideRef.current?.focus();
    return () => {
      const prev = previousFocusRef.current;
      if (prev && prev.isConnected) prev.focus();
    };
  }, [open, mode]);

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
          {number != null && <PersonalTaskDetail key={number} projectKey={projectKey} number={number} onClose={close} asModal />}
        </DialogContent>
      </Dialog>
    );
  }

  // 리스트·체크리스트 뷰 → 페이지 헤더 아래 본문 안 보조 칸. md+ 는 목록 칸을 밀어 공존(툴바 비가림),
  // < md 는 좁은 화면 보호용 fixed 오버레이. dim 없음(목록 계속 클릭 가능). 닫힘 시 미렌더.
  if (number == null) return null;
  return (
    <aside
      ref={asideRef}
      role="complementary"
      aria-label="작업 상세"
      tabIndex={-1}
      data-testid="personal-task-panel"
      className={cn(
        'flex min-h-0 flex-col border-l bg-card',
        'max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-50 max-md:w-full max-md:max-w-[400px] max-md:shadow-xl',
        'md:relative md:w-[400px] md:shrink-0',
      )}
    >
      {/* 보조 칸 소제목 줄(34px) — 페이지 헤더가 아니라 본문 안 칸임을 드러낸다. 편집 가능한 제목(input h-8)은
          낮은 text-xs 줄에 맞지 않아 이 줄 바로 아래 본문 첫머리에 둔다. */}
      <div data-testid="personal-task-panel-header" className={subPaneHeaderClass}>
        <span>작업 상세</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="닫기"
          data-testid="personal-task-panel-close"
          className="size-7"
          onClick={close}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <PersonalTaskDetail key={number} projectKey={projectKey} number={number} onClose={close} />
    </aside>
  );
}

/**
 * 실제 이슈 단건 로드 및 필드 렌더. asModal=true 면 제목 줄(border-b)을 DialogTitle 과 함께 두고 닫기는 DialogContent 자체 사용.
 * 패널은 닫기가 상위 소제목 줄에 있으므로 제목을 본문 첫머리에 둔다.
 */
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
  // 조회·수정·404 판정·AI 화면 컨텍스트 등록은 모바일 전체 화면과 공유(WP-221).
  const { q, update, data } = usePersonalTask(projectKey, number);

  return (
    // 스크롤 컨테이너 — 외부 wrapper가 h-full flex flex-col이므로 flex-1로 남은 높이 채움.
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* 제목 줄 — 모달은 기존 헤더 줄(border-b p-3), 패널은 소제목 줄 바로 아래 본문 첫머리. */}
      <div className={asModal ? 'flex items-center justify-between border-b p-3' : cn(pageGutterClass, 'pt-4')}>
        {/* 제목 인라인 편집 — 패널·모달 공통(#718). 개인 이슈는 상세 페이지가 리다이렉트로 막혀
            드로어가 유일한 편집 경로이므로 여기에서 직접 편집한다. 모달은 Radix a11y 상 DialogTitle
            이 필수라 접근성용 텍스트만 sr-only 로 유지하고 편집 UI 를 시각적으로 노출한다. */}
        <div
          className="min-w-0 flex-1 text-sm font-medium"
          data-testid="personal-task-panel-title"
        >
          {asModal && (
            <DialogTitle className="sr-only">{data?.summary.title ?? '작업'}</DialogTitle>
          )}
          <InlineEditableTitle
            title={data?.summary.title ?? '작업'}
            disabled={!data || update.isPending}
            onSave={(t) => update.mutate({ title: t })}
          />
        </div>
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
      {data && (
        <div className="space-y-4 p-4">
          <Field label="상태">
            <IssueStatusSelect
              value={data.summary.status}
              disabled={update.isPending}
              onChange={(v) => update.mutate({ status: v })}
              blockedBy={data.summary.blockedBy}
              projectKey={projectKey}
            />
          </Field>
          <Field label="우선순위">
            <IssuePrioritySelect
              value={data.summary.priority}
              disabled={update.isPending}
              onChange={(v) => update.mutate({ priority: v })}
            />
          </Field>
          <Field label="마감">
            <input
              type="date"
              value={data.summary.dueDate ?? ''}
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
              current={data.summary.assignees}
            />
          </Field>
          <Field label="라벨">
            <div className="flex flex-wrap items-center gap-1">
              {data.summary.labels.map((l) => (
                <LabelChip key={l.id} label={l} size="sm" />
              ))}
              <LabelPickerPopover
                projectKey={projectKey}
                issueNumber={number}
                current={data.summary.labels}
              />
            </div>
          </Field>
          <Field label="메모">
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {data.body || '본문 없음'}
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
