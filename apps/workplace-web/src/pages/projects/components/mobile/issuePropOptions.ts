// 모바일 이슈 속성 시트 공용 옵션 파생(WP-196) — 상세 칩(IssueMobilePropertyChips)과 생성 칩(CreateIssueChips)이 공유한다.
import type { PickerOption } from '@/components/mobile/MobilePickerSheet';

/** 프로젝트 멤버 → 담당자 시트 옵션(value=userId 문자열). 로딩 중(undefined)이면 빈 목록. */
export function memberOptions(members: { userId: number; name: string }[] | undefined): PickerOption[] {
  return (members ?? []).map((m) => ({ value: String(m.userId), label: m.name }));
}
