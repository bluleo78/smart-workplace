// DM 표시명 파생 — name 이 없는 DM 을 참여자로 표기.
// 1:1 = 상대 이름, 그룹 = 상대들 이름 결합(3명 초과면 "외 N명" 축약).
import type { DmResponse } from '../types/messaging';

export function dmDisplayName(dm: DmResponse, currentUserId: number): string {
  const others = dm.participants.filter((p) => p.userId !== currentUserId);
  if (others.length === 0) return '(나)'; // 방어적 — 정상 DM 엔 발생 안 함
  if (others.length === 1) return others[0].name;
  if (others.length <= 3) return others.map((p) => p.name).join(', ');
  return `${others[0].name}, ${others[1].name} 외 ${others.length - 2}명`;
}
