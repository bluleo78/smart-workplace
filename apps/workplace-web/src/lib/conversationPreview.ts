// 모바일 채팅 목록 행(WP-135)의 미리보기 문구 규칙. 화면과 분리해 단위 테스트한다.
import type { LastMessageSummary } from '@/types/messaging'

/** 메시지가 하나도 없는 대화의 미리보기 자리 문구. */
export const EMPTY_PREVIEW = '아직 메시지가 없습니다'

/**
 * 목록 행 미리보기 한 줄 — 내 메시지는 "나: ", 1:1 DM 상대 메시지는 접두 없음(누가 보냈는지 자명),
 * 채널·그룹 DM 은 "이름: ". 작성자 이름을 모르면 접두를 생략한다.
 */
export function previewLine(
  last: LastMessageSummary | null | undefined,
  opts: { meId: number; isOneToOneDm: boolean },
): string {
  if (!last) return EMPTY_PREVIEW
  if (last.authorId === opts.meId) return `나: ${last.preview}`
  if (opts.isOneToOneDm || !last.authorName) return last.preview
  return `${last.authorName}: ${last.preview}`
}
