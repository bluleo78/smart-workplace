// 이슈 글(코멘트·본문)의 멘션 칩 — <@id> 토큰을 「@이름」 칩으로 보인다(WP-1134). 코멘트와 이슈 설명이 같은 모양을 쓰게 한 곳에 둔다.
// AI 는 AI 색, 사람은 중립색(#785, #208). whitespace-nowrap — 좁은 칸에서 「@」와 이름 사이가 줄바뀜되지 않게 한 덩어리로 둔다.
// 채팅(ChatMessageRow·MessageRow)의 칩은 본인 말풍선 배경에 맞춘 색 분기가 있어 따로 둔다.
import type { MentionSeg } from './parseMessageSegments';

export function IssueMentionChip({ seg, testId }: { seg: MentionSeg; testId: string }) {
  return (
    <span
      data-testid={testId}
      className={`whitespace-nowrap rounded px-1 font-medium ${seg.kind === 'AGENT' ? 'bg-ai-accent-subtle text-ai-accent' : 'bg-muted text-foreground'}`}
    >
      @{seg.name}
    </span>
  );
}
