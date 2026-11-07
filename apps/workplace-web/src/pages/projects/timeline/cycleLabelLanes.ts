import type { TimelineCycleBand } from './timelineTypes';

/**
 * 그릴 사이클 이름표 한 개의 자리(WP-1439).
 * - `cycle`: 이름표를 그릴 사이클 — 화면이 이 값만으로 이름표를 그리고 배치하게 담아 둔다.
 * - `lane`: 줄 번호(0부터).
 * - `folded`: 줄이 모자라 이 이름표에 접혀 들어온 사이클(시작일 순) — 「+N」 으로 보인다.
 * - `endDate`: 이름표가 덮을 가로 구간의 끝 — 자신과 접힌 사이클 가운데 가장 늦은 종료일. 자기 기간이 차트 왼쪽 밖으로 지나가도
 *   접힌 사이클이 아직 보이면 이름표(와 「+N」)가 차트 왼쪽 끝에 붙어 남고, 훨씬 뒤에 시작하는 접힌 사이클도 「+N」 으로 찾을 수 있게.
 */
export interface CycleLabelSlot {
  cycle: TimelineCycleBand;
  lane: number;
  folded: TimelineCycleBand[];
  endDate: string;
}

/**
 * 기간이 겹치는 사이클 이름표를 최대 maxLanes 줄로 나눈다(WP-489 줄 나누기 + WP-1439 줄 수 상한).
 * 반환 Map(사이클 id → 자리)에는 그릴 이름표만 시작일 순으로 든다 — id 가 없으면 접힌(그리지 않는) 사이클이다.
 *
 * 시작일 순(같으면 id 순 — 응답 순서가 바뀌어도 배치가 흔들리지 않게)으로 훑어, 앞 줄의 마지막 이름표 구간이 끝난 뒤에 시작하면
 * 그 줄에, 아니면 새 줄에 둔다. 줄이 이미 maxLanes 개라 들어갈 곳이 없으면 그 사이클은 그리지 않고 마지막 줄에 지금 놓인
 * 이름표의 「접힌 목록」에 넣는다 — 줄 수에 상한이 없으면 같은 기간 사이클 6~7개가 첫 행(40px)을 넘어 이슈 막대 위로 내려왔다.
 *
 * 접을 때 그 이름표의 구간 끝(endDate)을 접힌 사이클의 끝까지 늘린다(이미 더 늦으면 그대로). 줄의 끝도 이 값이라, 접힌 사이클
 * 기간 안에 시작하는 뒤 사이클은 그 줄에 오르지 않고 함께 접힌다 — 올랐다면 늘어난 이름표와 겹친다.
 * 날짜 문자열(yyyy-MM-dd)은 사전순 비교가 곧 날짜 비교다.
 */
export function layoutCycleLabelLanes(cycles: TimelineCycleBand[], maxLanes: number): Map<number, CycleLabelSlot> {
  // 줄이 0개면 아무 것도 못 그리므로 최소 1줄은 둔다.
  const laneLimit = Math.max(1, maxLanes);
  const slots = new Map<number, CycleLabelSlot>();
  // 줄마다 지금 놓인(마지막으로 들어간) 이름표 — 그 endDate 가 곧 줄의 끝이고, 접을 때 주인이 된다.
  const laneOwners: CycleLabelSlot[] = [];
  const sorted = [...cycles].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id - b.id);
  for (const band of sorted) {
    let lane = laneOwners.findIndex((owner) => owner.endDate < band.startDate);
    if (lane < 0 && laneOwners.length < laneLimit) lane = laneOwners.length;
    if (lane >= 0) {
      const slot: CycleLabelSlot = { cycle: band, lane, folded: [], endDate: band.endDate };
      slots.set(band.id, slot);
      laneOwners[lane] = slot;
      continue;
    }
    // 들어갈 줄이 없다 — 마지막 줄 이름표에 접고 그 구간을 늘린다.
    const owner = laneOwners[laneLimit - 1];
    owner.folded.push(band);
    if (band.endDate > owner.endDate) owner.endDate = band.endDate;
  }
  return slots;
}
