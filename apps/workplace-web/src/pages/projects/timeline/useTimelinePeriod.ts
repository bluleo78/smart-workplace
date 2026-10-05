// 타임라인 조회 기간 훅(WP-247) — URL `period` 를 읽고 쓰며, 사이클 목록으로 실제 기간을 푼다. 데스크톱 드롭다운·모바일 칩 시트가 공유한다.
// 사이클이 필요한 기간(active·cycle)인데 사이클 조회가 끝나기 전이면 ready=false — 페이지는 이 동안 간트·아젠다를 그리지 않아
// 걸러지지 않은 목록이 비치지 않게 한다. 분기·rolling·직접 지정·전체는 사이클 없이 풀리므로 기다리지 않는다.
import { format, parseISO } from 'date-fns';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useCycles } from '../../../hooks/queries/useCycles';
import { parsePeriodParam, periodParamToString, resolvePeriod } from './timelineData';
import type { PeriodParam } from './timelineTypes';

export function useTimelinePeriod(projectKey: string) {
  const [params, setParams] = useSearchParams();
  const cycles = useCycles(projectKey);
  const raw = params.get('period');
  const param = useMemo(() => parsePeriodParam(raw), [raw]);
  const cycleList = useMemo(() => cycles.data ?? [], [cycles.data]);
  // 오늘은 날짜(일) 단위로만 쓰므로 렌더마다 새로 만들어도 결과가 같다 — 문자열 키로 메모를 고정한다.
  const todayKey = format(new Date(), 'yyyy-MM-dd');
  // 사이클 조회 실패면 활성 사이클 기본값 대신 rolling 으로 대체(안내 문구 포함).
  // 캐시된 사이클이 있으면 백그라운드 재조회가 실패해도 그 데이터로 푼다 — 데이터가 아예 없을 때만 대체 기간.
  const cyclesFailed = cycles.isError && !cycles.data;
  const period = useMemo(
    () => resolvePeriod(param, cycleList, parseISO(todayKey), { cyclesFailed }),
    [param, cycleList, todayKey, cyclesFailed],
  );
  const setParam = (p: PeriodParam) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const s = periodParamToString(p);
        if (s) next.set('period', s);
        else next.delete('period');
        return next;
      },
      { replace: true },
    );
  const needsCycles = param.kind === 'active' || param.kind === 'cycle';
  return { param, period, cycles: cycleList, ready: !(needsCycles && cycles.isLoading), setParam };
}
