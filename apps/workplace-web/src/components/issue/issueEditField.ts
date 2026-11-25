// 이슈 제목·본문 편집 안내가 함께 쓰는 필드 이름·조사(WP-2095) — 충돌 배너와 「다른 사람이 바꿨습니다」 토스트가 한 곳에서 문구를 만든다.
// 왜: 라벨 맵과 「을/으로」 판정이 두 파일에 따로 있으면 필드가 늘 때 한쪽만 고쳐 문구가 어긋난다. 조사는 lib/utils 헬퍼로 고른다.
import { eulReul } from '@/lib/utils';

/** 편집 안내 대상 필드. */
export type IssueEditField = 'title' | 'body';

/** 안내에 쓰는 필드 이름. */
export const ISSUE_EDIT_FIELD_LABEL: Record<IssueEditField, string> = { title: '제목', body: '본문' };

/** 충돌 중 저장이 막혔을 때 토스트 문구 — 제목·본문 편집기가 같은 문구를 쓴다(「…제목이/본문이 있습니다」). */
export function issueEditConflictBlockedMessage(field: IssueEditField): string {
  return `다른 사람이 먼저 저장한 ${ISSUE_EDIT_FIELD_LABEL[field]}이 있습니다. 덮어쓰려면 [내 글로 덮어쓰기…]를 눌러 주세요`;
}

/** 「{필드}을(를)」 — 받침 유무로 조사를 붙인다(제목을·본문을). */
export function issueEditFieldObject(field: IssueEditField): string {
  const label = ISSUE_EDIT_FIELD_LABEL[field];
  return `${label}${eulReul(label)}`;
}
