// AI 답 뒤 후속 질문 칩(WP-139, 시안 A) — 마지막 어시스턴트 턴 바로 아래 왼쪽 정렬, 테두리만 있는 알약 3개(좁으면 줄바꿈). 머리말·아이콘 없음.
// 생성 중 안내 없이 결과가 오면 살짝 나타난다(동작 줄이기 존중).
// 마우스(데스크톱): 칩 26px·12px 글자, 줄 간격 6px(시안). 터치(pointer-coarse, 모바일): 칩 36px·14px 글자(시안 휴대폰 칩) +
// 위아래 8px 터치 확장(HIT_AREA_Y_COARSE), 줄 간격 16px = 확장 8px×2 — 줄바꿈 시 아랫줄 칩의 위쪽 확장이 윗줄 칩 아래 여백의
// 탭을 가로채지 않게(겹치면 뒤 형제가 이긴다). 모바일 판정을 화면 폭이 아닌 포인터로 해 큰 터치 화면도 넓은 간격을 받는다.
import { HIT_AREA_Y_COARSE } from '@/lib/hitArea';
import { cn } from '@/lib/utils';

interface Props {
  items: string[];
  /** 전송이 막힌 상태 — 칩을 비활성으로 그린다. */
  disabled: boolean;
  onPick: (query: string) => void;
}

export function FollowupChips({ items, disabled, onPick }: Props) {
  return (
    <div data-testid="chat-followups" className="flex flex-wrap gap-1.5 pl-1 pointer-coarse:gap-y-4 animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      {items.map((q, i) => (
        <button
          key={`${i}-${q}`} // 문구 중복 제거는 ai-agent 가 한다 — 혹시 겹쳐도 key 가 충돌하지 않게 위치를 붙인다
          type="button"
          data-testid="chat-followup"
          disabled={disabled}
          onClick={() => onPick(q)}
          className={cn(
            HIT_AREA_Y_COARSE,
            'rounded-full border px-3 py-1 text-left text-xs leading-4 text-foreground hover:bg-muted',
            // 터치: 16px + 18px 줄 높이 + 테두리 2px = 36px. text-sm 은 leading-4 가 남긴 줄 높이를 따르므로 줄 높이도 함께 바꾼다.
            'pointer-coarse:py-2 pointer-coarse:text-sm pointer-coarse:leading-4.5',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          {q}
        </button>
      ))}
    </div>
  );
}
