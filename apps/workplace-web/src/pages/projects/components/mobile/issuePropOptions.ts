// 모바일 이슈 속성 시트 공용 옵션 파생(WP-196) — 상세 칩(IssueMobilePropertyChips)과 생성 칩(CreateIssueChips)이 공유한다.
import type { PickerOption } from '@/components/mobile/MobilePickerSheet';

import { assigneeCandidates } from '../../../../lib/assigneeCandidates'
import { displayNameWithStatus } from '../../../../lib/userStatus';

/**
 * 프로젝트 멤버 → 담당자 시트 옵션(value=userId 문자열). 로딩 중(undefined)이면 빈 목록.
 * 비활성 구성원은 빼고, 이미 담당 중(keepIds)이면 「(비활성)」을 붙여 남긴다 — 해제할 수 있게(WP-487).
 */
export function memberOptions(
  members: { userId: number; name: string; active?: boolean }[] | undefined,
  keepIds: readonly number[] = [],
): PickerOption[] {
  return assigneeCandidates(members, keepIds).map((m) => ({
    value: String(m.userId),
    label: displayNameWithStatus(m),
  }));
}
