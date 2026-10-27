// 모바일 이슈 속성 공용 시트(WP-196) — 상세 칩(IssueMobilePropertyChips)과 생성 칩(CreateIssueChips)이 같은 에픽 선택 시트를 쓴다.
// 구성요소 다중 선택 시트(WP-933)도 여기 둔다.
import { EpicColorDot } from '@/components/issues/EpicColorDot';
import { MobileMultiPickerSheet } from '@/components/mobile/MobileMultiPickerSheet';
import { MobilePickerSheet } from '@/components/mobile/MobilePickerSheet';

import { pickerComponentOptions } from '../../../../lib/issueComponents';
import type { ComponentResponse } from '../../../../types/component';
import type { IssueResponse } from '../../../../types/issue';

// 「에픽 없음」 옵션 값 — 시트 안에서만 쓰고 밖으로는 null 로 주고받는다.
const NO_EPIC = 'none';

// 색점(WP-1017)용 epicColor·type 은 선택 — 없으면 회색 점.
type EpicOption = Pick<IssueResponse, 'number' | 'title' | 'childDoneCount' | 'childCount'> &
  Partial<Pick<IssueResponse, 'epicColor' | 'type'>>;

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
      // 선택된 에픽 줄만 ✓ 때문에 숫자가 밀리지 않게 모든 줄에 ✓ 자리를 둔다.
      reserveCheck
      value={value != null ? String(value) : NO_EPIC}
      options={[
        { value: NO_EPIC, label: '에픽 없음' },
        // 완료/전체는 폭 고정·오른쪽 정렬 — 길이가 다른 숫자도 줄마다 같은 자리에 선다.
        ...epics.map((e) => ({
          value: String(e.number),
          label: e.title,
          icon: <EpicColorDot epic={e} />,
          hint: <span className="inline-block min-w-[7ch] text-right tabular-nums">{e.childDoneCount}/{e.childCount}</span>,
        })),
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

/**
 * 구성요소 다중 선택 시트(WP-933) — 사용 중 구성요소(+ 이미 고른 보관 구성요소)를 목록 순서로. 닫힐 때 최종 선택 id 를 한 번 알린다.
 * 구성요소가 8개를 넘으면 검색창을 띄운다(에픽 시트와 같은 기준).
 */
export function ComponentPickerSheet({
  open, onClose, components, value, testId,
}: {
  open: boolean;
  onClose: (ids: number[]) => void;
  components: ComponentResponse[];
  value: number[];
  testId: string;
}) {
  const options = pickerComponentOptions(components, value);
  return (
    <MobileMultiPickerSheet
      testId={testId}
      open={open}
      title="구성요소"
      searchable={options.length > 8}
      value={value.map(String)}
      options={options.map((c) => ({ value: String(c.id), label: c.archived ? `${c.name} (보관됨)` : c.name }))}
      onClose={(picked) => {
        // 목록 순서로 정리해 돌려준다 — 서버 자동 지정·칩 순서와 같게.
        const chosen = new Set(picked.map(Number));
        onClose(options.filter((c) => chosen.has(c.id)).map((c) => c.id));
      }}
    />
  );
}
