// 모바일 개인 작업 전체 화면 상세(WP-221) — 데스크톱의 400px 사이드 패널·중앙 모달은 좁은 화면에서 목록을 가리거나
// 768~1023px 에서 콘텐츠를 짓눌렀다. 팀 이슈 상세(WP-196)와 같은 구조: 상단 바(‹ · 프로젝트 이름) → 제목 → 속성 칩 → 메모 → 채팅,
// 맨 아래 in-flow 줄(채팅 입력 / 제목 편집 중엔 [취소·저장]). 높이 --vvh·위치 --vv-top 이라 키보드가 뜨면 입력줄이 바로 위에 붙는다.
// DialogContent 대신 원시 Content — index.css 의 [data-slot=dialog-content] 키보드 규칙(가운데 정렬·max-height)을 피한다(생성 시트와 동일).
// z-[46] — Sonner 토스트(z-47)·되돌리기 토스트가 레이어 아래로 숨지 않게 AI 풀스크린과 같은 층(PageHeader 45 위, 토스트 47 아래). 안에서 여는 시트·팝오버(z-50 포털)는 여전히 위.
// 메모는 데스크톱과 같이 읽기 전용(편집 경로가 없다 — R4), 상단 바엔 데스크톱 패널 헤더에 있던 닫기(‹)만 둔다.
import { ChevronLeft } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useState } from 'react';

import { mobileBackButtonClass, mobileDetailBarClass, mobileDetailTitleClass } from '@/components/mobile/headerClass';
import { useProject } from '@/hooks/queries/useProjects';

import { IssueChatSection } from '../components/chat/IssueChatSection';
import { InlineEditableTitle } from '../components/InlineEditableTitle';
import { IssueMobilePropertyChips, type MobilePropField } from '../components/mobile/IssueMobilePropertyChips';
import { type EditBarControls, MobileEditBar } from '../components/mobile/MobileEditBar';
import { usePersonalTask } from './usePersonalTask';

// 개인 작업 칩 — 마감이 담당자보다 앞(개인은 담당이 대개 본인), 에픽 대신 라벨, 「＋ 속성」 없음(스펙 §4.2).
const PERSONAL_FIELDS: MobilePropField[] = ['status', 'priority', 'due', 'assignee', 'label'];

/** ?task=N 이 있으면 열린다(열림의 단일 원천은 PersonalTaskPanel 의 useHistoryParam). 닫기 = onClose(시스템 뒤로가기와 같은 경로). */
export function PersonalTaskMobile({
  projectKey,
  number,
  onClose,
}: {
  projectKey: string;
  number: number | null;
  onClose: () => void;
}) {
  return (
    // modal={false} — modal 이면 body 가 pointer-events:none 이 되어 body 아래 Sonner 토스트(되돌리기 등)를 누를 수 없다. 전체 화면이라 스크롤 락·딤은 불필요.
    <DialogPrimitive.Root modal={false} open={number != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
        {/* 작업이 바뀌면(같은 라우트에서 다른 task) 편집 상태·포털 대상을 새로 시작하도록 key 로 리마운트. */}
        {number != null && <PersonalTaskMobileContent key={number} projectKey={projectKey} number={number} onClose={onClose} />}
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PersonalTaskMobileContent({ projectKey, number, onClose }: { projectKey: string; number: number; onClose: () => void }) {
  const { q, update, data } = usePersonalTask(projectKey, number);
  const project = useProject(projectKey);
  // 제목 편집 중이면 하단 줄이 [취소·저장] 바로 바뀐다(모바일 제목은 blur 저장이 없다 — WP-196 R5).
  const [titleControls, setTitleControls] = useState<EditBarControls | null>(null);
  // 채팅 입력줄 포털 대상(R11) — ref 콜백으로 받아 상태로 둔다(마운트 뒤 IssueChatSection 이 이 요소로 포털).
  const [chatFooterEl, setChatFooterEl] = useState<HTMLDivElement | null>(null);
  const title = data?.summary.title ?? '작업';

  return (
    <DialogPrimitive.Content
      data-testid="personal-task-mobile"
      aria-describedby={undefined}
      onOpenAutoFocus={(e) => e.preventDefault()}
      // non-modal 이라 레이어 밖(토스트 등) 탭이 outside-interaction 으로 레이어를 닫지 않게.
      onInteractOutside={(e) => e.preventDefault()}
      // 제목 편집 중 Esc 는 편집 취소만(InlineEditableTitle 이 처리) — Radix 가 document 캡처 단계에서 Esc 를 먼저 받아 레이어까지 닫지 않게(R10).
      onEscapeKeyDown={(e) => {
        if (titleControls) e.preventDefault();
      }}
      className="fixed inset-x-0 top-[var(--vv-top,0px)] z-[46] flex h-[var(--vvh,100dvh)] flex-col bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] outline-none [:root[data-keyboard-open]_&]:pb-0"
    >
      <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
      <header className={mobileDetailBarClass}>
        <button
          type="button"
          aria-label="뒤로"
          data-testid="personal-task-panel-close"
          onClick={onClose}
          className={mobileBackButtonClass}
        >
          <ChevronLeft className="h-6 w-6" aria-hidden />
        </button>
        <span className={mobileDetailTitleClass}>{project.data?.name ?? ''}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 p-4">
          {/* 제목 — 모바일은 blur 저장 없이 하단 바·Enter 로 저장(commitOnBlur=false). aria-label 로 편집 버튼 이름이 제목에 섞이지 않게(#791). */}
          <h1 className="text-2xl leading-8 font-semibold tracking-tight" aria-label={title} data-testid="personal-task-panel-title">
            <InlineEditableTitle
              title={title}
              disabled={!data || update.isPending}
              onSave={(t) => update.mutate({ title: t })}
              commitOnBlur={false}
              onEditingChange={setTitleControls}
            />
          </h1>

          {q.isLoading && <p className="text-sm text-muted-foreground">로딩 중…</p>}
          {q.error && (
            <div data-testid="personal-task-panel-notfound" className="text-sm text-destructive">
              작업을 찾을 수 없습니다.
              <button type="button" onClick={onClose} className="ml-2 min-h-11 min-w-11 underline">
                닫기
              </button>
            </div>
          )}

          {data && (
            <>
              <IssueMobilePropertyChips
                projectKey={projectKey}
                issue={data.summary}
                // 개인 작업은 소유자만 보므로 편집 가능(데스크톱 패널도 update.isPending 만으로 막는다).
                canEditWorkflow
                updatePending={update.isPending}
                onPatch={(c) => update.mutate(c)}
                fields={PERSONAL_FIELDS}
              />
              <section aria-label="메모" className="space-y-1">
                <h2 className="text-xs font-medium text-muted-foreground">메모</h2>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground [overflow-wrap:anywhere]">{data.body || '본문 없음'}</p>
              </section>
              {/* AI 위임 대화 = 기존 이슈 chat 재사용. 입력줄은 아래 하단 줄로 포털된다. */}
              <div data-testid="personal-panel-chat">
                <IssueChatSection projectKey={projectKey} issueNumber={number} footerContainer={chatFooterEl} plain />
              </div>
            </>
          )}
        </div>
      </div>

      {/* 하단 in-flow 줄 — 레이어가 --vvh 로 줄어 키보드 바로 위에 붙는다(키보드 원칙 ②). */}
      <div className="shrink-0 bg-background" data-testid="personal-task-bottom-bar">
        {titleControls && (
          <div className="border-t px-4 py-2">
            <MobileEditBar controls={titleControls} />
          </div>
        )}
        {/* 편집 바가 뜬 동안에도 채팅 입력줄은 언마운트하지 않고 숨긴다 — 쓰던 메시지 초안 보존(팀 상세와 동일). ChatComposer 가 border-t 를 가진다. */}
        <div ref={setChatFooterEl} hidden={titleControls != null} />
      </div>
    </DialogPrimitive.Content>
  );
}
