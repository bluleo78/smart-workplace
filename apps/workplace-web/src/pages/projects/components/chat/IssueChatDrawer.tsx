// 이슈 채팅 드로워 — 헤더 아이콘 버튼으로 여는 우측 오버레이(채널 '파일' 드로워 패턴 미러, #76).
// 무엇을: Sheet 기반 우측 드로워에 IssueChatSection 임베드. open 일 때만 마운트해 thread lazy fetch.
// 왜: 채팅을 3컬럼 고정 영역에서 빼내 본문 폭을 확보하고, 필요할 때만 대화 컨텍스트를 연다.

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

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
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[32rem]"
        data-testid="issue-chat-drawer"
        // #884: Radix 는 열릴 때 내용 안 첫 tabbable 에 포커스를 준다. 본인 메시지 툴바가 opacity 토글이라
        // (hidden 이 아님) 그 버튼이 첫 tabbable 이 되어, 열자마자 첫 본인 메시지 툴바가 포커스로 드러난다.
        // 포커스를 컨테이너 자체로 돌려 툴바는 hover/키보드 탐색 때만 나타나게 한다.
        // 스레드 로드 후 컴포저가 마운트되면 컴포저가 autoFocus 로 포커스를 가져간다(정밀 포인터 한정).
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          if (e.currentTarget instanceof HTMLElement) e.currentTarget.focus();
        }}
      >
        <SheetHeader className="shrink-0 border-b px-4 py-3">
          <SheetTitle className="text-sm">채팅</SheetTitle>
          {/* Radix Dialog description 부재 경고 해소(#361 패턴) */}
          <SheetDescription className="sr-only">이슈 채팅</SheetDescription>
        </SheetHeader>
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
