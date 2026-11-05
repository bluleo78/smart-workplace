// 드라이브 공유 링크 비밀번호 검증(WP-1385) — ShareLinkModal 이 쓰는 순수 판정.
// 「보이는 글자 없음」의 기준은 lib/visibleText(hasVisibleText) — 서버 PersonNames.hasVisibleChar 와 같은 범위다.
import { hasVisibleText } from '@/lib/visibleText';

import { isPasswordWithinBytes, PASSWORD_BYTES_MESSAGE } from './user';

/** 공백만 넣은 공유 링크 비밀번호 안내 — 서버가 400 으로 돌려주는 문구와 같다. */
export const PASSWORD_BLANK_ONLY_MESSAGE = '비밀번호에 공백만 넣을 수 없어요. 비밀번호를 입력하거나 칸을 비워 주세요.';

/**
 * 비밀번호가 공백·안 보이는 문자(NBSP·제로폭 문자·한글 채움·점자 빈칸 등)만으로 이뤄졌는지. 빈 문자열은
 * 「칸을 비움 = 비밀번호 없음」이라 false 다. 이런 값이 조용히 「비밀번호 없는 링크」로 바뀌거나, 사용자가 비밀번호를
 * 걸었다고 착각하지 않도록 막을 때 쓴다.
 */
export function isBlankOnlyPassword(value: string): boolean {
  return value !== '' && !hasVisibleText(value);
}

/**
 * 공유 링크 비밀번호 입력의 오류 문구(없으면 null). 빈 칸은 비밀번호 없음이라 오류가 아니다.
 * 72바이트 초과(bcrypt 한도, WP-497)를 먼저, 그다음 공백만(WP-1385)을 본다.
 */
export function sharePasswordError(value: string): string | null {
  if (!isPasswordWithinBytes(value)) return PASSWORD_BYTES_MESSAGE;
  if (isBlankOnlyPassword(value)) return PASSWORD_BLANK_ONLY_MESSAGE;
  return null;
}
