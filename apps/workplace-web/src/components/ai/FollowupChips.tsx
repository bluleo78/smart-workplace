// AI 답 뒤 후속 질문 칩(WP-139, 시안 A) — 마지막 어시스턴트 턴 바로 아래 왼쪽 정렬, 테두리만 있는 알약 3개(좁으면 줄바꿈). 머리말·아이콘 없음.
// 생성 중 안내 없이 결과가 오면 살짝 나타난다(동작 줄이기 존중). 모바일 터치 영역 40px 이상 — 칩 높이 26px + 위아래 8px(HIT_AREA_Y).
// 줄 간격 gap-y-4(16px) = 위아래 확장 8px×2 — 줄바꿈 시 아랫줄 칩의 위쪽 확장이 윗줄 칩 아래 여백의 탭을 가로채지 않게(겹치면 뒤 형제가 이긴다).
import { HIT_AREA_Y } from '@/lib/hitArea';
import { cn } from '@/lib/utils';

interface Props {
  items: string[];
  /** 전송이 막힌 상태 — 칩을 비활성으로 그린다. */
  disabled: boolean;
  onPick: (query: string) => void;
}

export function FollowupChips({ items, disabled, onPick }: Props) {
  return (
    <div data-testid="chat-followups" className="flex flex-wrap gap-x-1.5 gap-y-4 pl-1 animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      {items.map((q) => (
        <button
          key={q} // 문구는 저장소·이력 변환에서 중복을 걸러 고유하다
          type="button"
          data-testid="chat-followup"
          disabled={disabled}
          onClick={() => onPick(q)}
          className={cn(
            HIT_AREA_Y,
            'rounded-full border px-3 py-1 text-left text-xs leading-4 text-foreground hover:bg-muted',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50',
          )}
        >
          {q}
        </button>
      ))}
    </div>
  );
}
