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

/**
 * 받는 사람이 모두 정지된 DM 판정(WP-723) — 나 말고 남은 참여자가 있고 전원이 이 워크스페이스에서 비활성이면 true. 서버도 이때 전송을 막으므로
 * 화면은 입력창 대신 안내를 보인다. 그룹 DM 에 활성 참여자가 한 명이라도 있으면 false, 나만 남은 DM(셀프·상대가 나감)도 false.
 */
export function isDmRecipientInactive(dm: DmResponse, currentUserId: number): boolean {
  const others = dm.participants.filter((p) => p.userId !== currentUserId);
  return others.length > 0 && others.every((p) => p.active === false);
}

/** 셀프 DM 판정(단일 규칙) — 참여자가 1명 이상이고 전원이 본인. 참여자 없는 DM 은 셀프 DM 이 아니다. */
export function isSelfDm(dm: DmResponse, currentUserId: number): boolean {
  return dm.participants.length > 0 && dm.participants.every((p) => p.userId === currentUserId)
}

/**
 * 사이드바 DM 아이콘에 그릴 사람(WP-1466) — 나를 뺀 참여자 중 앞의 두 명(참여자 순서 그대로).
 * 1:1 은 한 명이라 그 사람 아바타, 그룹은 두 명이라 반씩 나눈 동그라미로 그린다 — 같은 상대와의 1:1 방과 그룹 방이 같아 보이지 않게.
 * 셀프 DM 은 빈 목록(호출부가 내 아바타를 따로 그린다).
 */
export function dmAvatarPeople(dm: DmResponse, currentUserId: number): DmResponse['participants'] {
  return dm.participants.filter((p) => p.userId !== currentUserId).slice(0, 2);
}
