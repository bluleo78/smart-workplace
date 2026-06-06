// DM 표시명 파생 — name 이 없는 DM 을 참여자로 표기.
// 1:1 = 상대 이름, 그룹 = 상대들 이름 결합(3명 초과면 "외 N명" 축약).
import type { DmResponse } from '../types/messaging';

export function dmDisplayName(dm: DmResponse, currentUserId: number): string {
  const others = dm.participants.filter((p) => p.userId !== currentUserId);
  if (others.length === 0) {
    // self-DM — 본인 이름 + "(나)" (Slack 의 "(you)" 방식).
    const me = dm.participants.find((p) => p.userId === currentUserId);
    return me ? `${me.name} (나)` : '(나)';
  }
  if (others.length === 1) return others[0].name;
  if (others.length <= 3) return others.map((p) => p.name).join(', ');
  return `${others[0].name}, ${others[1].name} 외 ${others.length - 2}명`;
}
