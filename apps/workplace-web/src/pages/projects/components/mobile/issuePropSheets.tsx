// 모바일 이슈 속성 공용 시트(WP-196) — 상세 칩(IssueMobilePropertyChips)과 생성 칩(CreateIssueChips)이 같은 에픽 선택 시트를 쓴다.
import { MobilePickerSheet } from '@/components/mobile/MobilePickerSheet';

import type { IssueResponse } from '../../../../types/issue';

// 「에픽 없음」 옵션 값 — 시트 안에서만 쓰고 밖으로는 null 로 주고받는다.
const NO_EPIC = 'none';

type EpicOption = Pick<IssueResponse, 'number' | 'title' | 'childDoneCount' | 'childCount'>;

/**
 * 에픽 단일 선택 시트 — 「에픽 없음」 + 에픽 목록(오른쪽에 완료/전체 하위 수). 에픽이 8개를 넘으면 검색창을 띄운다.
 * value·onSelect 는 에픽 번호(null = 에픽 없음) — 변경 여부 판단·저장은 호출부 몫.
 */
export function EpicPickerSheet({
  open, onClose, epics, loading = false, value, onSelect, testId,
}: {
  open: boolean;
  onClose: () => void;
  epics: EpicOption[];
  /** 에픽 목록 조회 중 — 목록이 아직 비었으면 「에픽 없음」 아래 「불러오는 중…」 줄을 보여 "에픽이 없다"로 읽히지 않게 한다. */
  loading?: boolean;
  value: number | null;
  onSelect: (epicNumber: number | null) => void;
  testId: string;
}) {
  return (
    <MobilePickerSheet
      testId={testId}
      open={open}
      onClose={onClose}
      title="에픽"
      searchable={epics.length > 8}
      value={value != null ? String(value) : NO_EPIC}
      options={[
        { value: NO_EPIC, label: '에픽 없음' },
        ...epics.map((e) => ({ value: String(e.number), label: e.title, hint: `${e.childDoneCount}/${e.childCount}` })),
      ]}
      onSelect={(v) => onSelect(v === NO_EPIC ? null : Number(v))}
      // 지연 조회(시트를 처음 열 때 시작) 중엔 선택 불가 안내 줄 — 「에픽 없음」은 그대로 고를 수 있다.
      listFooter={
        loading && epics.length === 0 ? (
          <div role="status" data-testid={`${testId}-loading`} className="flex min-h-11 items-center px-4 text-sm text-muted-foreground">
            불러오는 중…
          </div>
        ) : undefined
      }
    />
  );
}
