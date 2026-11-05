// 이슈 채팅 드로워 — 헤더 아이콘 버튼으로 여는 우측 오버레이(채널 '파일' 드로워 패턴 미러, #76).
// 무엇을: Sheet 기반 우측 드로워에 IssueChatSection 임베드. open 일 때만 마운트해 thread lazy fetch.
// 왜: 채팅을 3컬럼 고정 영역에서 빼내 본문 폭을 확보하고, 필요할 때만 대화 컨텍스트를 연다.
// 모바일(lg 미만): 화면 전체를 덮는 한 단계 깊은 화면으로 보이도록 기본 X 대신 상세 헤더 규격(h-14 [‹] 키 채팅)을 쓰고,
// 노치·홈 인디케이터 안전 영역만큼 위아래를 비운다(H2·L2). 데스크톱 헤더·X 는 그대로.

import { ChevronLeft } from 'lucide-react';

import { useAiPanelAwareDialog } from '@/components/ai/useAiPanelAwareDialog';
import {
  mobileBackButtonClass,
  mobileDetailBarClass,
  mobileDetailTitleClass,
} from '@/components/mobile/headerClass';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { DialogOpenerProbe, useDialogFocusRestore } from '@/hooks/useDialogFocusRestore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';

import { IssueChatSection } from './IssueChatSection';

/**
 * 서랍 열림 자동 포커스 — 첫 tabbable(본인 메시지 툴바) 대신 서랍 컨테이너 자체에 포커스를 준다(#884).
 * 모듈 상수로 두어 useDialogFocusRestore 의 콜백이 렌더마다 다시 만들어지지 않게 한다.
 */
function focusDrawerContainer(e: Event) {
  e.preventDefault();
  if (e.currentTarget instanceof HTMLElement) e.currentTarget.focus();
}

export function IssueChatDrawer({
  projectKey,
  issueNumber,
  open,
  onClose,
}: {
  projectKey: string;
  issueNumber: number;
  open: boolean;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  // AI 옆 패널과 공존(WP-54 공용 훅, WP-1374) — side 모드면 서랍을 non-modal 로 열어 패널을 aria-hidden·포인터 차단으로 막지 않고,
  // 패널 클릭·포커스로 서랍이 닫히지 않으며, 서랍은 패널 왼쪽에 붙는다. 엔티티 다이얼로그(개인 작업 모달 등)와 같은 규칙이라
  // 모달 위에 서랍을 연 채로도 AI 에 「이 작업…」을 물을 수 있다. 패널이 닫혀 있으면 기존 modal 동작 그대로다.
  // 닫힐 때 연 요소(채팅 버튼)로 포커스를 되돌린다 — Radix 기본 복원은 <SheetTrigger> 로 열 때만 동작해, 버튼 + open 상태로 여는
  // 이 서랍은 닫으면 포커스가 body(개인 작업 모달 위에서 열었으면 모달 틀)로 빠졌다(WP-1374, Dialog 의 #708 과 같은 처리).
  // 핸들러는 모듈 상수 — 인라인 화살표면 렌더마다 새 함수라 훅의 콜백이 매번 다시 만들어진다.
  const focusRestore = useDialogFocusRestore(focusDrawerContainer, undefined);
  // #884: Radix 는 열릴 때 내용 안 첫 tabbable 에 포커스를 준다. 본인 메시지 툴바가 opacity 토글이라
  // (hidden 이 아님) 그 버튼이 첫 tabbable 이 되어, 열자마자 첫 본인 메시지 툴바가 포커스로 드러난다.
  // 포커스를 컨테이너 자체로 돌려 툴바는 hover/키보드 탐색 때만 나타나게 한다(focusDrawerContainer).
  // 스레드 로드 후 컴포저가 마운트되면 컴포저가 autoFocus 로 포커스를 가져간다(정밀 포인터 한정).
  // 공용 훅이 먼저 돈다 — AI 모드 전환으로 서랍이 다시 마운트되면(modal↔non-modal) 포커스 이동·복원을 막고(⌘K 로 연 패널 입력창 유지)
  // 그때는 컨테이너로 끌어오지 않는다. 닫힘은 공용 훅이 세션 첫 열림 때의 요소로 돌리고, 못 돌렸으면 연 요소 복원이 맡는다.
  const aiAware = useAiPanelAwareDialog({
    open,
    size: 'drawer',
    handlers: { onOpenAutoFocus: focusRestore.onOpenAutoFocus, onCloseAutoFocus: focusRestore.onCloseAutoFocus },
  });
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      modal={aiAware.modal}
    >
      {/* side 모드 — Radix 가 non-modal 에선 오버레이를 그리지 않으므로 페이지 영역만 덮는 dim 을 직접 둔다(패널 쪽은 비움). */}
      {aiAware.overlay}
      <SheetContent
        side="right"
        className={cn(
          'flex w-full flex-col gap-0 p-0 sm:max-w-[32rem] max-lg:pt-[env(safe-area-inset-top)] max-lg:pb-[env(safe-area-inset-bottom)]',
          aiAware.contentClassName,
        )}
        data-testid="issue-chat-drawer"
        // 모바일은 헤더의 ‹ 가 닫기 — 우상단 X 를 함께 두면 닫기가 두 개가 된다.
        showCloseButton={!isMobile}
        // AI 표면(패널·칩)을 누르거나 포커스가 그리로 가도 서랍은 닫지 않는다. Esc 를 패널에서 누르면 패널만 닫는다. 열림·닫힘 포커스는 위 aiAware 참고.
        {...aiAware.contentProps}
      >
        <DialogOpenerProbe onMount={focusRestore.captureOpener} />
        {isMobile ? (
          // 병합 상세 헤더(MobileDetailBar)와 같은 치수(headerClass 공용 클래스). 그 컴포넌트를 쓰지 않는 이유: 뒤 페이지 헤더와 testid(mobile-back)가
          // 겹치고, ✦·히스토리 뒤로가기 규칙까지 따라온다 — 여기서 ‹ 는 "드로워 닫기"(onClose → ?chat=1 되돌림)다.
          <div className={mobileDetailBarClass}>
            <button
              type="button"
              data-testid="issue-chat-drawer-back"
              aria-label="채팅 닫기"
              onClick={onClose}
              className={mobileBackButtonClass}
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <SheetTitle data-testid="issue-chat-drawer-title" className={mobileDetailTitleClass}>
              {projectKey}-{issueNumber} 채팅
            </SheetTitle>
            <SheetDescription className="sr-only">이슈 채팅</SheetDescription>
          </div>
        ) : (
          <SheetHeader className="shrink-0 border-b px-4 py-3">
            <SheetTitle className="text-sm">채팅</SheetTitle>
            {/* Radix Dialog description 부재 경고 해소(#361 패턴) */}
            <SheetDescription className="sr-only">이슈 채팅</SheetDescription>
          </SheetHeader>
        )}
        {/* open 일 때만 마운트 — 닫혀 있을 땐 thread/messages 조회·SSE 구독을 하지 않는다.
            embedded: 카드 크롬 없이 드로워 높이를 채움(메시지 flex-1 스크롤 + 컴포저 하단 고정). */}
        <div className="flex min-h-0 flex-1 flex-col">
          {open && (
            <IssueChatSection projectKey={projectKey} issueNumber={issueNumber} embedded />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
