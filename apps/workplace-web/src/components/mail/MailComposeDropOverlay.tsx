// 메일 작성창 위로 파일을 끌어 왔을 때 창 전체를 덮는 안내(WP-574). 놓기는 작성창(useComposerFileDrop)이 받는다 — 오버레이는 포인터를 통과시킨다.
// 채팅 입력창 오버레이(ComposerDropOverlay)는 작은 입력칸용 점선 상자라, 큰 작성창에는 실선 테두리 + 가운데 안내로 따로 둔다.
// 부모(작성창 패널)가 position 을 가져야 한다(fixed 패널이라 그대로 기준이 된다).

import { Paperclip } from 'lucide-react';

import { COMPOSE_ATTACHMENT_LIMIT_WORD } from '@/lib/mailComposeAttachments';

const DROP_HINT = '여기에 놓으면 첨부돼요';

/**
 * active 동안만 덮개를 그린다. 낭독용 live 영역은 늘 마운트해 두고 글만 바꾼다 — 덮개와 함께 영역이 생기면 첫 안내를 읽지 않는 화면 낭독기가 있어서.
 * 덮개 자체는 눈으로 보는 안내라 aria-hidden.
 */
export function MailComposeDropOverlay({ active }: { active: boolean }) {
  return (
    <>
      <span role="status" className="sr-only" data-testid="mail-compose-drop-status">
        {active ? DROP_HINT : ''}
      </span>
      {active && <DropCover />}
    </>
  );
}

function DropCover() {
  return (
    <div
      aria-hidden
      data-testid="mail-compose-drop-overlay"
      // rounded-[inherit] — 작은 창(위만 둥긂)·크게 보기(네 모서리)·모바일(각짐) 모양을 그대로 따른다.
      // z-20 — 모바일 하단 서식 버튼(z-10)까지 덮는다.
      className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-[inherit] bg-background/90 ring-2 ring-primary ring-inset backdrop-blur-[2px]"
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Paperclip className="size-6" aria-hidden />
      </span>
      <span className="flex flex-col items-center gap-1">
        <span className="text-sm font-medium text-foreground">{DROP_HINT}</span>
        <span className="text-xs text-muted-foreground">한 메일에 {COMPOSE_ATTACHMENT_LIMIT_WORD}까지</span>
      </span>
    </div>
  );
}
