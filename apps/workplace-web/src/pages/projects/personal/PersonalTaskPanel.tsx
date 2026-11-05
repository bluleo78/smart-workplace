// 개인 작업 상세(데스크톱) — 목록·보드 모두 넓은 모달로 연다(WP-1374). 옛 400px 옆 칸(리스트)·좁은 모달(보드)을 대체했다.
// 왜: 메모가 길어도 넓게 읽고 고치며, 속성은 오른쪽 레일에 모아 두기 위해. 채팅은 팀 이슈 상세와 같은 UX — 머리의 채팅 버튼이
// 오른쪽 채팅 서랍(IssueChatDrawer)을 모달 위에 연다. ?task=N 이 열림, ?chat=1 이 서랍 열림의 단일 원천이다.
// 모바일(<1024px)은 전체 화면 상세(PersonalTaskMobile) 그대로다.
import { X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { useAiPanelAwareDialog } from '@/components/ai/useAiPanelAwareDialog';
import { AgentWorkCard } from '@/components/issue/agentWork/AgentWorkCard';
import { InlineEditableBody, type InlineEditableBodyHandle } from '@/components/issue/InlineEditableBody';
import { TaskRecurrenceField } from '@/components/issue/recurrence/TaskRecurrenceField';
import { LabelChip } from '@/components/labels/LabelChip';
import { LabelPickerPopover } from '@/components/labels/LabelPickerPopover';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useHistoryParam } from '@/hooks/useHistoryParam';
import { useIsMobile } from '@/hooks/useIsMobile';
import { isTextEntryTarget } from '@/lib/escapeOverlay';
import { parseId } from '@/lib/historyParam';
import { isSupportedDateKey, SUPPORTED_DATE_MAX, SUPPORTED_DATE_MIN, SUPPORTED_DATE_RANGE_MESSAGE } from '@/lib/supportedDate';
import { cn } from '@/lib/utils';
import type { UpdateIssueRequest } from '@/types/issue';

import { useProjectStatusList } from '../../../hooks/queries/useProjectStatuses';
import { AssigneePickerPopover } from '../components/AssigneePickerPopover';
import { IssueChatButton } from '../components/chat/IssueChatButton';
import { IssueChatDrawer } from '../components/chat/IssueChatDrawer';
import { useIssueChatDrawerParam } from '../components/chat/useIssueChatDrawerParam';
import { InlineEditableTitle } from '../components/InlineEditableTitle';
import { IssuePrioritySelect } from '../components/IssuePrioritySelect';
import { IssueStatusSelect } from '../components/IssueStatusSelect';
import { useVersionedPatch } from '../hooks/useVersionedPatch';
import { PersonalTaskMobile } from './PersonalTaskMobile';
import { usePersonalTask } from './usePersonalTask';

/**
 * ?task=N 쿼리 파라미터를 감지해 상세를 연다 — 데스크톱은 넓은 모달, 모바일은 전체 화면.
 */
export function PersonalTaskPanel({ projectKey }: { projectKey: string }) {
  // ?task=N — 열림의 단일 원천. 닫기(✕·ESC·바깥 클릭)는 공용 히스토리 닫기:
  // 리스트 행이 push 로 연 항목은 되돌리고, 보드 카드 Link·리다이렉트로 들어온 항목은 출발 화면으로,
  // 콜드 딥링크는 task 만 지운다(WP-208).
  const taskParam = useHistoryParam('task');
  const number = parseId(taskParam.value);
  const isMobile = useIsMobile();

  // 모바일(<1024px) — 전체 화면 상세(WP-221). 데스크톱 — 넓은 모달(WP-1374).
  return isMobile ? (
    <PersonalTaskMobile projectKey={projectKey} number={number} onClose={taskParam.close} />
  ) : (
    <PersonalTaskModal projectKey={projectKey} number={number} close={taskParam.close} />
  );
}

/**
 * 닫기 전에 모달 안에서 포커스를 가진 칸을 blur 한다 — 제목 입력은 blur 로 저장하므로(commitOnBlur), 고치던 제목이 닫기와 함께 저장된다.
 * 왜: 바깥(dim) 클릭은 pointerdown 에서 바로 닫혀, 입력칸이 blur 를 받기 전에 사라지면 고친 제목이 소리 없이 없어진다.
 */
function flushFocusedField(container: HTMLElement | null) {
  const active = document.activeElement;
  if (container && active instanceof HTMLElement && container.contains(active)) active.blur();
}

/** 데스크톱 넓은 모달 — 폭 70rem(1120px)·높이 85vh, 화면이 작으면 화면 안(좌우·위아래 1rem 여백)에 맞춘다. */
function PersonalTaskModal({
  projectKey,
  number,
  close,
}: {
  projectKey: string;
  number: number | null;
  close: () => void;
}) {
  const open = number != null;
  // AI 옆 패널과 공존(WP-54 공용 훅) — 옛 리스트 옆 칸은 모달이 아니어서 작업을 연 채 AI 에 「이 작업…」을 물을 수 있었다.
  // 모달로 바뀐 뒤에도 AI 패널이 side 모드면 non-modal 로 열려 그 흐름을 지킨다(패널 쪽은 비우고 페이지 영역 가운데).
  const aiAware = useAiPanelAwareDialog({
    open,
    size: 'wide',
    handlers: {
      // 글을 고치는 칸(메모 편집칸·제목 입력)의 Esc 는 편집 취소 몫이라 모달을 닫지 않는다 — Radix 는 문서 캡처 단계에서 Esc 를 먼저 받아
      // 모달을 닫아 버려, 칸의 「Esc = 편집 취소」가 모달째 닫기가 되었다. 체크박스·날짜 칸 등은 취소할 글이 없어 모달을 닫는다.
      onEscapeKeyDown: (e) => {
        if (isTextEntryTarget(e.target)) e.preventDefault();
      },
    },
  });
  // 메모를 고친 채 저장하지 않았는가(InlineEditableBody 가 알린다) — 그 상태로 닫으면(dim·✕·Esc) 고친 메모가 사라지므로 먼저 묻는다.
  const [memoDirty, setMemoDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // 버리고 닫을 때 메모 초안(localStorage, #824)을 지울 손잡이 — 버린다고 했는데 다음 편집에 「작성 중이던 내용」으로 되살아나지 않게.
  const memoRef = useRef<InlineEditableBodyHandle | null>(null);

  /** 닫기 요청 공통 경로(dim·✕·Esc·「닫기」) — 고친 메모가 있으면 확인을 띄우고, 없으면 포커스 칸(제목)을 저장한 뒤 닫는다. */
  const requestClose = () => {
    if (memoDirty) {
      setConfirmClose(true);
      return;
    }
    flushFocusedField(contentRef.current);
    close();
  };
  /** 확인 창 「버리고 닫기」 — 메모 초안을 지우고 닫는다. */
  const discardAndClose = () => {
    setConfirmClose(false);
    memoRef.current?.discardDraft();
    close();
  };

  return (
    // dim·ESC·바깥 클릭 닫기·포커스 가둠/복원은 Radix. 서랍(채팅)이 위에 열려 있으면 ESC·바깥 클릭은 서랍부터 닫는다(Radix 레이어 순서).
    <Dialog open={open} onOpenChange={(o) => { if (!o) requestClose(); }} modal={aiAware.modal}>
      {aiAware.overlay}
      <DialogContent
        ref={contentRef}
        data-testid="personal-task-modal"
        showCloseButton={false}
        className={cn(
          'flex h-[min(85vh,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(70rem,calc(100%-2rem))]',
          aiAware.contentClassName,
          // side 모드 — 페이지 영역(화면 - AI 패널 폭) 안에서도 70rem 을 넘지 않게.
          !aiAware.modal && 'lg:max-w-[min(70rem,calc(100%-var(--ai-side-width,0px)-2rem))]',
        )}
        {...aiAware.contentProps}
      >
        {/* Radix a11y — DialogContent 에 설명 필수(없으면 콘솔 경고). 화면엔 숨김. */}
        <DialogDescription className="sr-only">작업 상세 보기</DialogDescription>
        {number != null && (
          <PersonalTaskDetail
            key={number}
            projectKey={projectKey}
            number={number}
            onClose={requestClose}
            onMemoDirtyChange={setMemoDirty}
            memoRef={memoRef}
          />
        )}
        {/* 고친 메모를 두고 닫을 때의 확인 — 모달 안(React 트리)에 두어 확인 창 클릭이 모달의 바깥 클릭으로 취급되지 않는다. */}
        <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
          <AlertDialogContent data-testid="personal-task-discard-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>저장하지 않은 메모를 버릴까요?</AlertDialogTitle>
              <AlertDialogDescription>닫으면 고친 메모가 사라집니다.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="personal-task-discard-keep">계속 쓰기</AlertDialogCancel>
              <AlertDialogAction variant="destructive" data-testid="personal-task-discard-confirm" onClick={discardAndClose}>
                버리고 닫기
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 작업 단건 로드 및 모달 내용 — 머리(제목 인라인 편집 · 채팅 · 닫기), 본문 왼쪽 메모, 오른쪽 속성 레일, 그리고 채팅 서랍.
 */
function PersonalTaskDetail({
  projectKey,
  number,
  onClose,
  onMemoDirtyChange,
  memoRef,
}: {
  projectKey: string;
  number: number;
  onClose: () => void;
  /** 메모를 고친 채 저장하지 않았는지 — 모달이 닫기 전에 확인을 묻는다. */
  onMemoDirtyChange: (dirty: boolean) => void;
  /** 메모 편집기 손잡이 — 모달 「버리고 닫기」가 초안을 지운다. */
  memoRef: React.Ref<InlineEditableBodyHandle>;
}) {
  // 조회·수정·404 판정·AI 화면 컨텍스트 등록은 모바일 전체 화면과 공유(WP-221).
  const task = usePersonalTask(projectKey, number);
  const { q, update, data } = task;
  // 상태 선택지 — 개인 프로젝트도 시드 상태 목록(이름)을 갖는다(WP-808).
  const statuses = useProjectStatusList(projectKey);
  // 채팅 서랍(WP-1374) — 팀 이슈와 같은 ?chat=1. 서랍이 모달 위에 겹치므로 링크로 들어와 열린 서랍도 닫으면 모달로 돌아온다(unmarkedClose).
  // 작업을 못 찾으면(404) 서랍을 열 수 없어 chat 을 지운다 — 같은 화면에서 다음에 여는 작업에 chat=1 이 묻어가지 않게.
  const chat = useIssueChatDrawerParam({ unmarkedClose: 'replace', clearWhen: !!q.error });

  // #611 메모는 편집을 시작한 순간의 version 을 저장 기준으로 고정한다 — 쓰는 사이 AI 가 메모를 바꿨다면 덮어쓰지 않고 409 로 알린다(팀 이슈 본문과 같은 공용 훅).
  const { patch, beginEdit, baseVersion } = useVersionedPatch<'body'>(update, data?.summary.version);
  /** 결과를 기다리지 않는 필드 저장(상태·우선순위·마감·제목). */
  const save = (changes: UpdateIssueRequest) => { void patch(changes); };

  return (
    <>
      {/* 머리 — 제목 인라인 편집(개인 작업은 풀페이지가 리다이렉트로 막혀 여기가 유일한 편집 경로, #718) · 채팅 · 닫기. */}
      <div className="flex shrink-0 items-center gap-2 border-b px-5 py-3">
        <div className="min-w-0 flex-1 text-base font-semibold" data-testid="personal-task-panel-title">
          {/* Radix a11y 상 DialogTitle 필수 — 접근성용 텍스트만 sr-only, 편집 UI 를 시각적으로 노출한다. */}
          <DialogTitle className="sr-only">{data?.summary.title ?? '작업'}</DialogTitle>
          <InlineEditableTitle
            title={data?.summary.title ?? '작업'}
            disabled={!data || update.isPending}
            onSave={(t) => save({ title: t })}
          />
        </div>
        {/* 채팅 버튼 — 팀 이슈 헤더와 같은 버튼·읽지 않은 수. 오른쪽 채팅 서랍을 연다(열려 있으면 읽는 중으로 보고 0). */}
        {data && <IssueChatButton projectKey={projectKey} issueNumber={number} open={chat.open} onOpen={chat.openChat} />}
        <Button
          variant="ghost"
          size="icon"
          aria-label="닫기"
          data-testid="personal-task-close"
          className="size-8"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* 로딩 중 */}
      {q.isLoading && <p className="p-5 text-sm text-muted-foreground">로딩 중…</p>}

      {/* 에러 / 찾을 수 없음 */}
      {q.error && (
        <div data-testid="personal-task-panel-notfound" className="p-5 text-sm text-destructive">
          작업을 찾을 수 없습니다.
          <button type="button" onClick={onClose} className="ml-2 underline">
            닫기
          </button>
        </div>
      )}

      {data && (
        <div className="flex min-h-0 flex-1">
          {/* 왼쪽 — AI 진행 + 메모. 이 칸만 세로 스크롤한다. */}
          <div data-testid="personal-task-memo" className="min-w-0 flex-1 space-y-4 overflow-y-auto p-5">
            {/* AI 진행(WP-1372) — 팀 이슈처럼 본문 위. 진행 중 AI 작업이 없으면 그리지 않는다. 「답변 필요」 배지는 채팅 서랍을 연다. */}
            <AgentWorkCard list={data.summary.agentWork} onOpenChat={chat.openChat} />
            {/* 메모 — 팀 이슈 본문과 같은 렌더·편집(InlineEditableBody). 편집 권한은 이슈 내용 수정 권한과 같다. */}
            <section aria-label="메모" className="space-y-2">
              <h2 className="text-base leading-6 font-medium">메모</h2>
              <InlineEditableBody
                body={data.body}
                ref={memoRef}
                onSave={(b) => patch({ body: b, version: baseVersion('body') })}
                onEditStart={() => beginEdit('body')}
                disabled={!(data.viewerCanEditContent ?? false) || update.isPending}
                projectKey={projectKey}
                issueNumber={number}
                editLabel="메모 편집"
                onDirtyChange={onMemoDirtyChange}
              />
            </section>
          </div>
          {/* 오른쪽 — 속성 레일(상태·우선순위·마감·담당자·AI 에게 맡기기·라벨). 사이클·의존성·커스텀필드·구독은 개인 작업에 없다. */}
          <aside aria-label="속성" data-testid="personal-task-rail" className="w-[300px] shrink-0 space-y-4 overflow-y-auto border-l p-4">
            <Field label="상태">
              <IssueStatusSelect
                value={data.summary.statusId}
                statuses={statuses}
                currentName={data.summary.statusName}
                disabled={update.isPending}
                onChange={(s) => save({ statusId: s.id })}
                blockedBy={data.summary.blockedBy}
                projectKey={projectKey}
              />
            </Field>
            <Field label="우선순위">
              <IssuePrioritySelect
                value={data.summary.priority}
                disabled={update.isPending}
                onChange={(v) => save({ priority: v })}
              />
            </Field>
            <Field label="마감">
              <DueDateInput
                value={data.summary.dueDate ?? null}
                onSave={(next) => save(next ? { dueDate: next } : { clearDueDate: true })}
              />
            </Field>
            <Field label="담당자">
              <AssigneePickerPopover
                projectKey={projectKey}
                issueNumber={number}
                current={data.summary.assignees}
              />
            </Field>
            {/* AI 에게 맡기기(WP-989, WP-1314) — 정한 시각마다 담당 AI 가 이 작업을 실행한다(옛 「반복」 칸). */}
            <Field label="AI 에게 맡기기">
              <TaskRecurrenceField projectKey={projectKey} number={number} />
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
          </aside>
        </div>
      )}

      {/* 채팅 서랍 — 팀 이슈 상세와 같은 오른쪽 서랍. 모달 안(React 트리)에 두어 Radix 가 중첩 레이어로 다룬다:
          서랍이 위에 겹치고, ESC·바깥 클릭은 서랍부터 닫으며, 닫히면 포커스가 모달(채팅 버튼)로 돌아온다. */}
      {data && <IssueChatDrawer projectKey={projectKey} issueNumber={number} open={chat.open} onClose={chat.closeChat} />}
    </>
  );
}

/**
 * 마감 입력(WP-903) — native 날짜 칸은 연도를 치는 도중에도 「0002-10-23」 같은 완성된 값을 내보낸다.
 * 바로 저장하면 서버가 거절하고, 저장 중 칸을 잠그면 나머지 숫자가 사라져 마감일을 입력할 수 없었다.
 * - 친 값은 칸 안에서만 들고(draft), 받는 범위(1900~9999)의 날짜가 되었을 때만 저장한다. 저장 중에도 잠그지 않는다.
 * - 칸을 비우면(다 지움) 마감을 지운다. 일부만 지운 상태(badInput)는 빈 값과 구분해 지우지 않는다.
 * - 범위 밖 날짜로 칸을 떠나면 안내하고 저장된 값으로 되돌린다. 덜 친 채 떠나면 조용히 되돌린다.
 */
function DueDateInput({ value, onSave }: { value: string | null; onSave: (next: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? '');
  // 저장된 값이 바뀌면(저장 완료·다른 곳에서 수정) 칸도 따라간다.
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(value ?? '');
  }
  return (
    <input
      type="date"
      aria-label="마감"
      data-testid="personal-task-due"
      min={SUPPORTED_DATE_MIN}
      max={SUPPORTED_DATE_MAX}
      value={draft}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        if (next === '') {
          if (!e.target.validity.badInput && value) onSave(null);
          return;
        }
        if (isSupportedDateKey(next) && next !== value) onSave(next);
      }}
      onBlur={(e) => {
        if (draft === (value ?? '') && !e.target.validity.badInput) return;
        if (draft !== '' && !isSupportedDateKey(draft)) toast.error(SUPPORTED_DATE_RANGE_MESSAGE);
        // 덜 친 칸(badInput)은 React 값이 '' 그대로라 다시 그려도 칸의 숫자가 남는다 — 직접 비운 뒤 저장된 값으로 돌린다.
        if (e.target.validity.badInput) e.target.value = '';
        setDraft(value ?? '');
      }}
      className="rounded border bg-background px-2 py-1 text-sm"
    />
  );
}

/** 속성 한 칸 — 라벨 위, 값(컨트롤) 아래. 팀 이슈 속성 레일과 같은 배치. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}
