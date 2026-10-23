// 첨부 공용 한도 — 이슈 첨부·메인 AI 채팅 첨부(WP-234)가 같은 서버 상한(workplace.storage.attachment)을 쓰므로 한 곳에 둔다.
// API 클라이언트를 끌어오지 않는 순수 모듈이라 lib 규칙·vitest 에서도 가볍게 import 한다.
import { eunNeun } from '@/lib/utils';

/** 파일당 업로드 상한 — 서버 workplace.storage.attachment 와 같은 25MB. */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

/** 파일 하나가 한도를 넘었을 때 안내 — 이슈 첨부·팀 채팅·이슈 챗이 같은 문구를 쓴다(WP-848). 예: 「보고서.pdf는 25MB 한도를 초과합니다」. */
export function oversizeFileMessage(name: string): string {
  return `${name}${eunNeun(name)} 25MB 한도를 초과합니다`;
}
