import { describe, expect, it } from 'vitest';

import { type CycleLabelSlot, layoutCycleLabelLanes } from './cycleLabelLanes';
import type { TimelineCycleBand } from './timelineTypes';

// 테스트용 사이클 — 이름은 id 로 만든다.
const cyc = (id: number, startDate: string, endDate: string): TimelineCycleBand => ({
  id,
  name: `사이클 ${id}`,
  startDate,
  endDate,
});

// 결과를 읽기 쉬운 모양으로 — 그릴 이름표마다 줄·접힌 id 목록·구간 끝. Map 에 없는 id 는 접힌 사이클이다.
// 키와 slot.cycle 의 id 가 어긋나면 잡히도록 slot.cycle 이 키와 같은지도 함께 본다.
const summarize = (slots: Map<number, CycleLabelSlot>) =>
  Object.fromEntries(
    [...slots].map(([id, slot]) => {
      expect(slot.cycle.id).toBe(id);
      return [id, { lane: slot.lane, folded: slot.folded.map((c) => c.id), endDate: slot.endDate }];
    }),
  );

describe('layoutCycleLabelLanes (WP-1439)', () => {
  it('그릴 이름표는 시작일 순으로 들고, 이름표마다 그 사이클을 담는다', () => {
    const later = cyc(2, '2026-10-20', '2026-10-28');
    const earlier = cyc(1, '2026-10-01', '2026-10-14');
    const slots = layoutCycleLabelLanes([later, earlier], 2);
    expect([...slots.values()].map((slot) => slot.cycle)).toEqual([earlier, later]);
  });

  it('사이클이 없으면 빈 결과다', () => {
    expect(layoutCycleLabelLanes([], 2).size).toBe(0);
  });

  it('기간이 겹치지 않으면 모두 첫 줄이고 구간 끝은 제 종료일이다', () => {
    const slots = layoutCycleLabelLanes(
      [cyc(1, '2026-10-01', '2026-10-14'), cyc(2, '2026-10-15', '2026-10-28'), cyc(3, '2026-10-29', '2026-11-11')],
      2,
    );
    expect(summarize(slots)).toEqual({
      1: { lane: 0, folded: [], endDate: '2026-10-14' },
      2: { lane: 0, folded: [], endDate: '2026-10-28' },
      3: { lane: 0, folded: [], endDate: '2026-11-11' },
    });
  });

  it('두 개가 겹치면 0·1 줄로 나눈다', () => {
    const slots = layoutCycleLabelLanes([cyc(1, '2026-10-15', '2026-10-28'), cyc(2, '2026-10-20', '2026-11-03')], 2);
    expect(summarize(slots)).toEqual({
      1: { lane: 0, folded: [], endDate: '2026-10-28' },
      2: { lane: 1, folded: [], endDate: '2026-11-03' },
    });
  });

  it('같은 기간 7개면 2개만 그리고 나머지 5개는 1번 줄 이름표에 접힌다(+5)', () => {
    // 입력 순서를 뒤섞어도 시작일이 같으면 id 순으로 정한다.
    const cycles = [7, 3, 5, 1, 6, 2, 4].map((id) => cyc(id, '2026-10-01', '2026-10-14'));
    const slots = layoutCycleLabelLanes(cycles, 2);
    expect(summarize(slots)).toEqual({
      1: { lane: 0, folded: [], endDate: '2026-10-14' },
      2: { lane: 1, folded: [3, 4, 5, 6, 7], endDate: '2026-10-14' },
    });
  });

  it('접힌 사이클이 더 늦게 끝나면 이름표 구간 끝(endDate)이 그 종료일까지 늘어난다', () => {
    // 3 은 주인(2)보다 훨씬 뒤까지 간다 — 2 의 기간이 지나가도 이름표가 3 이 끝날 때까지 남아야 「+1」 로 3 을 찾는다.
    const slots = layoutCycleLabelLanes(
      [cyc(1, '2026-10-01', '2026-12-31'), cyc(2, '2026-10-01', '2026-10-10'), cyc(3, '2026-10-05', '2026-11-20')],
      2,
    );
    expect(summarize(slots)).toEqual({
      1: { lane: 0, folded: [], endDate: '2026-12-31' },
      2: { lane: 1, folded: [3], endDate: '2026-11-20' },
    });
    // 접힌 사이클이 더 일찍 끝나면 줄이지 않는다.
    const shorter = layoutCycleLabelLanes(
      [cyc(1, '2026-10-01', '2026-12-31'), cyc(2, '2026-10-01', '2026-10-31'), cyc(3, '2026-10-05', '2026-10-10')],
      2,
    );
    expect(shorter.get(2)?.endDate).toBe('2026-10-31');
  });

  it('접힌 사이클이 끝나기 전에 시작하는 뒤 사이클은 마지막 줄에 다시 오르지 않고 함께 접힌다', () => {
    // 1번 줄 주인(2)은 10/10 에 끝나지만 접힌 3 이 10/31 까지라, 10/20 에 시작하는 4 는 1번 줄에 오르면 늘어난 이름표와 겹친다.
    const slots = layoutCycleLabelLanes(
      [
        cyc(1, '2026-10-01', '2026-11-30'),
        cyc(2, '2026-10-01', '2026-10-10'),
        cyc(3, '2026-10-05', '2026-10-31'),
        cyc(4, '2026-10-20', '2026-11-05'),
      ],
      2,
    );
    expect(summarize(slots)).toEqual({
      1: { lane: 0, folded: [], endDate: '2026-11-30' },
      2: { lane: 1, folded: [3, 4], endDate: '2026-11-05' },
    });
  });

  it('앞 이름표 구간이 끝나면 그 줄을 다시 쓰고, 새 주인이 이후 접힘을 받는다', () => {
    const slots = layoutCycleLabelLanes(
      [
        cyc(1, '2026-10-01', '2026-12-31'),
        cyc(2, '2026-10-01', '2026-10-14'),
        cyc(3, '2026-10-05', '2026-10-14'),
        // 2·3 이 끝난 뒤 시작 — 1번 줄을 다시 쓴다.
        cyc(4, '2026-10-15', '2026-10-28'),
        cyc(5, '2026-10-16', '2026-10-20'),
      ],
      2,
    );
    expect(summarize(slots)).toEqual({
      1: { lane: 0, folded: [], endDate: '2026-12-31' },
      2: { lane: 1, folded: [3], endDate: '2026-10-14' },
      4: { lane: 1, folded: [5], endDate: '2026-10-28' },
    });
  });

  it('겹치는 수가 줄 수와 같으면 접지 않고, 줄 수가 1이면 모두 첫 줄 이름표에 접는다', () => {
    const three = [cyc(1, '2026-10-01', '2026-10-14'), cyc(2, '2026-10-02', '2026-10-15'), cyc(3, '2026-10-03', '2026-10-16')];
    expect(summarize(layoutCycleLabelLanes(three, 3))).toEqual({
      1: { lane: 0, folded: [], endDate: '2026-10-14' },
      2: { lane: 1, folded: [], endDate: '2026-10-15' },
      3: { lane: 2, folded: [], endDate: '2026-10-16' },
    });
    expect(summarize(layoutCycleLabelLanes(three, 1))).toEqual({
      1: { lane: 0, folded: [2, 3], endDate: '2026-10-16' },
    });
  });
});
