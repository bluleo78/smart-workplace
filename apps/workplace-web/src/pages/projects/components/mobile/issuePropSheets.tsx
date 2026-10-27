// 모바일 이슈 속성 공용 시트(WP-196) — 상세 칩(IssueMobilePropertyChips)과 생성 칩(CreateIssueChips)이 같은 에픽 선택 시트를 쓴다.
// 구성요소 다중 선택 시트(WP-933)도 여기 둔다.
import { EpicColorDot } from '@/components/issues/EpicColorDot';
import { MobileMultiPickerSheet } from '@/components/mobile/MobileMultiPickerSheet';
import { MobilePickerSheet } from '@/components/mobile/MobilePickerSheet';
import { MOBILE_SHEET_ROW } from '@/components/mobile/MobileSheetShell';

import { IssueTypeBadge } from '../../../../components/issueTypes/IssueTypeBadge';
import { useOtherProjectEpics } from '../../../../hooks/queries/useOtherProjectEpics';
import { pickerComponentOptions } from '../../../../lib/issueComponents';
import { formatIssueKey } from '../../../../lib/issueKey';
import { isSameParent } from '../../../../lib/parentRef';
import type { ComponentResponse } from '../../../../types/component';
import type { IssueLookupItem, IssueResponse, ParentRef } from '../../../../types/issue';
import { epicFromSheetValue, type EpicSheetTarget, epicSheetValue, NO_EPIC_SHEET_OPTION } from './epicSheetValue';


// 색점(WP-1017)용 epicColor·type 은 선택 — 없으면 회색 점.
type EpicOption = Pick<IssueResponse, 'number' | 'title' | 'childDoneCount' | 'childCount'> &
  Partial<Pick<IssueResponse, 'epicColor' | 'type'>>;

/**
 * 에픽 단일 선택 시트 — 「에픽 없음」 + 에픽 목록(오른쪽에 완료/전체 하위 수). 에픽이 8개를 넘으면 검색창을 띄운다.
 * value 는 지금 고른 에픽(부모) — 다른 프로젝트·가려진 에픽이면(WP-1039) 어느 줄도 체크하지 않는다. 지금 값과 같은 에픽을 다시 고르면 onSelect 를
 * 부르지 않는다(헛 요청 방지 — 프로젝트까지 비교해 다른 프로젝트 CLA-5 부모에서 이 프로젝트 #5 를 고르는 건 변경이다).
 * projectKey 를 주면(WP-1039) 늘 검색창을 띄우고, 검색어로 읽을 수 있는 다른 프로젝트 에픽을 찾아 목록 아래 「다른 프로젝트」 줄로 보인다.
 */
export function EpicPickerSheet({
  open, onClose, epics, loading = false, value, onSelect, projectKey, testId,
}: {
  open: boolean;
  onClose: () => void;
  epics: EpicOption[];
  /** 에픽 목록 조회 중 — 목록이 아직 비었으면 「에픽 없음」 아래 「불러오는 중…」 줄을 보여 "에픽이 없다"로 읽히지 않게 한다. */
  loading?: boolean;
  value: Pick<ParentRef, 'projectKey' | 'number' | 'hidden'> | null | undefined;
  /** 고른 에픽(null = 에픽 없음) — 지금 값과 다를 때만 부른다. */
  onSelect: (target: EpicSheetTarget | null) => void;
  /** 이 이슈의 프로젝트 — 주면 다른 프로젝트 에픽도 찾는다(찾기의 출발 프로젝트). */
  projectKey?: string;
  testId: string;
}) {
  const ownKey = projectKey ?? '';
  const pick = (target: EpicSheetTarget | null) => {
    if (!isSameParent(value, target, ownKey)) onSelect(target);
  };
  const loadingRow = loading && epics.length === 0 && (
    <div role="status" data-testid={`${testId}-loading`} className="flex min-h-11 items-center px-4 text-sm text-muted-foreground">
      불러오는 중…
    </div>
  );
  return (
    <MobilePickerSheet
      testId={testId}
      open={open}
      onClose={onClose}
      title="에픽"
      // 다른 프로젝트 에픽은 찾아야 나오므로 그때는 에픽 수와 상관없이 검색창을 둔다.
      searchable={projectKey != null || epics.length > 8}
      // 선택된 에픽 줄만 ✓ 때문에 숫자가 밀리지 않게 모든 줄에 ✓ 자리를 둔다.
      reserveCheck
      value={epicSheetValue(value, ownKey)}
      options={[
        NO_EPIC_SHEET_OPTION,
        // 완료/전체는 폭 고정·오른쪽 정렬 — 길이가 다른 숫자도 줄마다 같은 자리에 선다.
        ...epics.map((e) => ({
          value: String(e.number),
          label: e.title,
          icon: <EpicColorDot epic={e} />,
          hint: <span className="inline-block min-w-[7ch] text-right tabular-nums">{e.childDoneCount}/{e.childCount}</span>,
        })),
      ]}
      onSelect={(v) => {
        const n = epicFromSheetValue(v);
        pick(n == null ? null : { number: n, title: epics.find((e) => e.number === n)?.title ?? '' });
      }}
      // 지연 조회(시트를 처음 열 때 시작) 중엔 선택 불가 안내 줄 — 「에픽 없음」은 그대로 고를 수 있다.
      listFooter={({ close, keyword, matchedCount }) => {
        if (projectKey == null) return loadingRow || null;
        // 다른 프로젝트 줄은 검색어가 비어도 늘 같은 자리에 둔다 — 첫 글자부터 디바운스가 걸리게(검색어가 생길 때 붙이면 첫 글자로 바로 묻는다).
        return (
          <>
            {loadingRow}
            <OtherProjectEpicRows
              keyword={keyword}
              projectKey={projectKey}
              hasOwnMatches={matchedCount > 0}
              testId={testId}
              onSelect={(epic) => {
                close();
                pick({ projectKey: epic.projectKey, number: epic.number, title: epic.title });
              }}
            />
          </>
        );
      }}
    />
  );
}

/**
 * 에픽 시트 아래 「다른 프로젝트」 줄(WP-1039) — 시트 검색어로 다른 프로젝트 에픽을 찾아 키·제목으로 보인다.
 * 찾기는 관계 추가 창과 같은 /issues/lookup(디바운스)이고 다른 프로젝트의 열린 에픽만 받는다(useOtherProjectEpics). 검색어가 비면 아무것도 그리지 않는다.
 * 이 프로젝트 줄이 하나도 맞지 않고 다른 프로젝트 결과도 없으면 「결과가 없습니다」를 띄운다 — 이 요소가 footer 라 시트가 대신 띄우지 못한다.
 */
function OtherProjectEpicRows({
  keyword, projectKey, hasOwnMatches, testId, onSelect,
}: {
  keyword: string;
  projectKey: string;
  hasOwnMatches: boolean;
  testId: string;
  onSelect: (epic: IssueLookupItem) => void;
}) {
  const { epics, searching } = useOtherProjectEpics(keyword, projectKey);
  if (keyword === '') return null;
  if (epics.length === 0) {
    if (searching) {
      return (
        <div role="status" data-testid={`${testId}-other-searching`} className="flex min-h-11 items-center px-4 text-sm text-muted-foreground">
          다른 프로젝트에서 찾는 중…
        </div>
      );
    }
    return hasOwnMatches ? null : <p className="px-4 py-6 text-center text-sm text-muted-foreground">결과가 없습니다</p>;
  }
  return (
    <div className="border-t" data-testid={`${testId}-other`}>
      <p className="px-4 pt-2 pb-1 text-xs font-medium text-muted-foreground">다른 프로젝트</p>
      {epics.map((epic) => {
        const key = formatIssueKey(epic.projectKey, epic.number);
        return (
          <button
            key={key}
            type="button"
            role="option"
            aria-selected={false}
            data-testid={`picker-other-epic-${key}`}
            onClick={() => onSelect(epic)}
            className={MOBILE_SHEET_ROW}
          >
            {epic.type && <IssueTypeBadge type={epic.type} size="sm" iconOnly />}
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{key}</span>
            <span className="min-w-0 flex-1 truncate">{epic.title}</span>
            <span className="size-5 shrink-0" aria-hidden />
          </button>
        );
      })}
    </div>
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
