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
      >
        <SheetHeader className="shrink-0 border-b px-4 py-3">
          <SheetTitle className="text-sm">채팅</SheetTitle>
          {/* Radix Dialog description 부재 경고 해소(#361 패턴) */}
          <SheetDescription className="sr-only">이슈 채팅</SheetDescription>
        </SheetHeader>
        {/* open 일 때만 마운트 — 닫혀 있을 땐 thread/messages 조회·SSE 구독을 하지 않는다. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {open && <IssueChatSection projectKey={projectKey} issueNumber={issueNumber} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
