// 이슈 화면의 그룹 기준 해석 훅(#878) — URL group 원값 + 뷰 + 사이클 유무로 실제 적용할 그룹을 정한다.
// 팀 목록·필터바·뷰 칩 바가 같은 판정을 공유해야 화면(구간 목록)·그룹 메뉴 표시·저장 뷰 페이로드가 어긋나지 않는다.

import { useSearchParams } from 'react-router-dom';

import { countOpenCycles } from '../lib/issueCycleSections';
import { parseGroupParam, parseView, resolveListGroupBy, toClientGroupBy } from '../lib/issueFilters';
import type { IssueGroupBy, IssueGroupParam } from '../types/issue';
import { useCycles } from './queries/useCycles';

export interface IssueGroupByState {
  /** URL group 원값(부재=null). 필터를 다시 쓸 때 그대로 보존한다. */
  raw: IssueGroupParam | null;
  /** 실제 적용할 그룹. 보드·사이클 비사용 화면에선 cycle 이 오지 않는다. */
  groupBy: IssueGroupBy | null;
  /** 사이클 목록 로딩 중이라 기본 그룹(사이클/없음) 판정을 보류 중 — 이동안 목록은 스켈레톤. */
  pending: boolean;
}

/**
 * @param cycleDefault 사이클 그룹을 쓰는 화면(팀 프로젝트)인지. false(개인)면 cycle 을 그룹 없음으로 본다.
 */
export function useIssueGroupBy(projectKey: string, cycleDefault: boolean): IssueGroupByState {
  const [params] = useSearchParams();
  const raw = parseGroupParam(params);
  const view = parseView(params);
  // 필터바 사이클 facet 과 같은 쿼리 키 — 캐시를 공유해 추가 요청이 없다.
  const cycles = useCycles(projectKey);

  // 보드·사이클 비사용 화면: 클라이언트 그룹만(부재·none·cycle → 그룹 없음). 보드 기본은 기존대로 상태 컬럼.
  if (!cycleDefault || view === 'board') {
    return { raw, groupBy: toClientGroupBy(raw === 'none' ? null : raw), pending: false };
  }
  // 목록: 사이클 목록을 못 받으면(오류) 그룹 없음으로 폴백 — 목록 자체를 막지 않는다.
  let openCount: number | undefined;
  if (cycles.data) openCount = countOpenCycles(cycles.data);
  else if (cycles.isError) openCount = 0;
  const resolved = resolveListGroupBy(raw, openCount);
  return { raw, groupBy: resolved ?? null, pending: resolved === undefined };
}
