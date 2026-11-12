// 개인 보고(WP-1486) 훅 — 보고서 설정 조회·저장, 「일일 보고 보기」 조회, 보고 만들기와 회차 폴링.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { createMeReport, fetchMeReport, fetchMeReportSettings, lookupMeReport, updateMeReportSettings } from '../../api/meReports'
import type { CreateMeReportRequest, MeReportKind, UpdateMeReportSettingsRequest } from '../../types/meReport'
import { wikiKeys } from './wikiKeys'

export const meReportKeys = {
  settings: ['meReportSettings'] as const,
  lookup: (kind: MeReportKind, date: string) => ['meReportLookup', kind, date] as const,
  report: (id: number) => ['meReport', id] as const,
}

/** 「일일 보고 보기」 조회를 신선하게 보는 시간 — 개요를 오갈 때마다 다시 묻지 않게(새 노트는 만들기 끝남이 무효화한다). */
const LOOKUP_STALE_MS = 60_000

/** 만드는 중(PENDING)인 회차를 다시 읽는 간격 — 1~3분 걸리는 생성을 3초마다 묻는다(P15). */
const REPORT_POLL_MS = 3000

/** 보고서 설정 — 창이 열릴 때만 읽는다(enabled). */
export function useMeReportSettings(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: meReportKeys.settings,
    queryFn: fetchMeReportSettings,
    enabled: options?.enabled ?? true,
  })
}

/** 설정 저장 — 응답(다음 실행 시각·템플릿 페이지가 바뀜)을 그대로 캐시에 넣는다(재조회 동안 옛 값이 깜빡이지 않게). */
export function useUpdateMeReportSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateMeReportSettingsRequest) => updateMeReportSettings(body),
    onSuccess: (data) => qc.setQueryData(meReportKeys.settings, data),
  })
}

/** 그 회차의 가장 최근 보고 노트(없으면 null) — 개요 「어제」 칸의 「일일 보고 보기」. 실패는 링크를 숨길 뿐이라 다시 시도하지 않는다. */
export function useMeReportLookup(kind: MeReportKind, date: string | null | undefined) {
  return useQuery({
    queryKey: meReportKeys.lookup(kind, date ?? ''),
    queryFn: () => lookupMeReport(kind, date!),
    enabled: !!date,
    staleTime: LOOKUP_STALE_MS,
    retry: false,
  })
}

/** 보고 만들기 — 결과(202 id)·오류(409·429) 처리는 화면이 한다. */
export function useCreateMeReport() {
  return useMutation({ mutationFn: (body: CreateMeReportRequest) => createMeReport(body) })
}

/**
 * 회차 상태 — id 가 있으면 읽고, PENDING 동안 3초마다 다시 읽는다. 만들어지면(GENERATED) 「일일 보고 보기」 조회와
 * 노트 트리를 무효화한다 — 새 노트가 「보고」 아래에 생겼기 때문이다(실패면 새 노트가 없어 그대로 둔다).
 */
export function useMeReport(id: number | null) {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: meReportKeys.report(id ?? 0),
    queryFn: () => fetchMeReport(id!),
    enabled: id != null,
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === 'PENDING' ? REPORT_POLL_MS : false),
  })
  const generated = query.data?.status === 'GENERATED'
  useEffect(() => {
    if (!generated) return
    void qc.invalidateQueries({ queryKey: ['meReportLookup'] })
    void qc.invalidateQueries({ queryKey: [...wikiKeys.all, 'tree'] })
  }, [generated, id, qc])
  return query
}
