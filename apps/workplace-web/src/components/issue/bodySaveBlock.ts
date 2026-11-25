// 본문 저장 막힘 판정(WP-2095) — 저장과 덮어쓰기가 같은 판정을 쓴다.
import { isSameBody } from '@/lib/issueDraft';
import { hasPendingToken } from '@/lib/markdownImageInsert';
import { ISSUE_BODY_MAX_LENGTH } from '@/lib/validations/issue';

/**
 * 본문 저장이 요청 없이 끝나는 이유 — 저장(save)과 덮어쓰기(overwrite)가 같은 판정을 쓴다.
 * 우선순위: 업로드 중 > 길이 초과 > 미완성 이미지 표지 > 바뀐 게 없음. 막힘이 없으면 null(저장이 실제로 나간다).
 */
export type BodySaveBlock = 'uploading' | 'too-long' | 'pending-token' | 'unchanged' | null;
export function bodySaveBlock(
  next: string,
  ctx: { uploading: boolean; body: string | null | undefined },
): BodySaveBlock {
  if (ctx.uploading) return 'uploading';
  if (next.length > ISSUE_BODY_MAX_LENGTH) return 'too-long';
  if (hasPendingToken(next)) return 'pending-token';
  if (isSameBody(next, ctx.body)) return 'unchanged';
  return null;
}
