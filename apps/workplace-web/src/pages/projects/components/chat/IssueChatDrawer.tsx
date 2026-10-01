// 이슈 채팅 드로워 — 헤더 아이콘 버튼으로 여는 우측 오버레이(채널 '파일' 드로워 패턴 미러, #76).
// 무엇을: Sheet 기반 우측 드로워에 IssueChatSection 임베드. open 일 때만 마운트해 thread lazy fetch.
// 왜: 채팅을 3컬럼 고정 영역에서 빼내 본문 폭을 확보하고, 필요할 때만 대화 컨텍스트를 연다.
// 모바일(lg 미만): 화면 전체를 덮는 한 단계 깊은 화면으로 보이도록 기본 X 대신 상세 헤더 규격(h-14 [‹] 키 채팅)을 쓰고,
// 노치·홈 인디케이터 안전 영역만큼 위아래를 비운다(H2·L2). 데스크톱 헤더·X 는 그대로.

import { ChevronLeft } from 'lucide-react';

import { mobileDetailTitleClass } from '@/components/mobile/headerClass';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/useIsMobile';

import { IssueChatSection } from './IssueChatSection';

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
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[32rem] max-lg:pt-[env(safe-area-inset-top)] max-lg:pb-[env(safe-area-inset-bottom)]"
        data-testid="issue-chat-drawer"
        // 모바일은 헤더의 ‹ 가 닫기 — 우상단 X 를 함께 두면 닫기가 두 개가 된다.
        showCloseButton={!isMobile}
        // #884: Radix 는 열릴 때 내용 안 첫 tabbable 에 포커스를 준다. 본인 메시지 툴바가 opacity 토글이라
        // (hidden 이 아님) 그 버튼이 첫 tabbable 이 되어, 열자마자 첫 본인 메시지 툴바가 포커스로 드러난다.
        // 포커스를 컨테이너 자체로 돌려 툴바는 hover/키보드 탐색 때만 나타나게 한다.
        // 스레드 로드 후 컴포저가 마운트되면 컴포저가 autoFocus 로 포커스를 가져간다(정밀 포인터 한정).
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          if (e.currentTarget instanceof HTMLElement) e.currentTarget.focus();
        }}
      >
        {isMobile ? (
          // 병합 상세 헤더(MobileDetailBar)와 같은 치수. 그 컴포넌트를 쓰지 않는 이유: 뒤 페이지 헤더와 testid(mobile-back)가
          // 겹치고, ✦·히스토리 뒤로가기 규칙까지 따라온다 — 여기서 ‹ 는 "드로워 닫기"(onClose → ?chat=1 되돌림)다.
          <div className="flex h-14 shrink-0 items-center gap-0.5 border-b px-1">
            <button
              type="button"
              data-testid="issue-chat-drawer-back"
              aria-label="채팅 닫기"
              onClick={onClose}
              className="flex h-11 w-11 shrink-0 items-center justify-center text-primary"
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
