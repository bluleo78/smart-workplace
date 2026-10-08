import { useEffect, useState } from 'react'

import { driveApi } from '../../api/drive'
import { needsPreviewConfirm } from '../../lib/previewContent'
import { withItemType } from './blobType'
import { downloadViewerItem } from './downloadViewerItem'
import { progressPercent } from './mediaPlayback'
import type { ViewerItem } from './types'

/** 받는 중 진행 — percent 는 0~100(분모를 모르면 null), loaded·total 은 바이트(total 모르면 null). */
export interface PreviewProgress {
  loaded: number
  total: number | null
  percent: number | null
}

/** % 를 모를 때 화면을 다시 그리는 간격(바이트) — 받은 크기 표시만 1MB 단위로 갱신한다. */
const UNKNOWN_TOTAL_STEP = 1024 * 1024

/**
 * 미리보기 원본 blob 받기 + 10MB 초과 확인(WP-203 → WP-277 이동).
 * 항목이 바뀌면(넘김) 이전 결과를 비우고, 늦게 온 이전 응답은 alive 가드로 버린다.
 * 동의는 항목 key 별 — 다른 파일로 넘기면 다시 묻는다.
 * trackProgress(WP-281 영상·오디오) — 통째로 받아야 재생되므로 스켈레톤 대신 % 를 보여 주려고 진행을 상태로 든다.
 * 진행 이벤트는 자주 오므로 정수 %(모르면 1MB 단위)가 바뀔 때만 상태를 바꾼다(재렌더 폭주 방지).
 */
export function usePreviewBlob(item: ViewerItem, enabled: boolean, { trackProgress = false }: { trackProgress?: boolean } = {}) {
  const [blob, setBlob] = useState<Blob | null>(null)
  const [error, setError] = useState(false)
  const [progress, setProgress] = useState<PreviewProgress | null>(null)
  const [consentedKey, setConsentedKey] = useState<string | null>(null)
  // 다시 시도 — 값이 바뀌면 같은 항목도 다시 받는다.
  const [attempt, setAttempt] = useState(0)
  const active = enabled && !item.unavailable
  const confirmSize = active && needsPreviewConfirm(item.sizeBytes, consentedKey === item.key) ? item.sizeBytes : null
  const waiting = confirmSize != null

  useEffect(() => {
    let alive = true
    setBlob(null)
    setError(false)
    setProgress(null)
    if (!active || waiting) return
    // 직전에 반영한 진행 단계(정수 % 또는 1MB 단위) — 같은 단계면 상태를 바꾸지 않는다.
    let lastStep = -1
    const onProgress = trackProgress
      ? ({ loaded, total }: { loaded: number; total: number | undefined }) => {
          if (!alive) return
          const percent = progressPercent(loaded, total, item.sizeBytes)
          const step = percent ?? Math.floor(loaded / UNKNOWN_TOTAL_STEP)
          if (step === lastStep) return
          lastStep = step
          setProgress({ loaded, total: total ?? item.sizeBytes ?? null, percent })
        }
      : undefined
    // 받기 시작 전에도 0% 를 보여 준다(첫 진행 이벤트는 응답 헤더 뒤에야 온다).
    if (trackProgress) setProgress({ loaded: 0, total: item.sizeBytes ?? null, percent: item.sizeBytes ? 0 : null })
    // 넘기거나 닫으면 받던 요청을 끊는다 — 영상·오디오는 최대 25MB 라 버려질 다운로드가 여러 개 겹치면 지금 항목이 느려지고 데이터를 낭비한다.
    const controller = new AbortController()
    driveApi
      .fetchBlobByPath(item.contentPath, { onProgress, signal: controller.signal })
      // octet-stream 응답은 항목 형식(메일 첨부의 파일명 추론 등)으로 다시 감싸 렌더러·공유 File 이 맞는 형식을 보게 한다.
      .then((b) => alive && setBlob(withItemType(b, item.mimeType)))
      .catch(() => alive && setError(true))
    return () => {
      alive = false
      controller.abort()
    }
  }, [item.contentPath, item.mimeType, item.sizeBytes, active, waiting, attempt, trackProgress])

  return {
    blob,
    error,
    progress,
    confirmSize,
    confirm: () => setConsentedKey(item.key),
    // 이미 받은 blob 이 있으면 다시 받지 않는다(감사 경로가 따로 없는 항목) — 판단은 downloadViewerItem.
    download: () => downloadViewerItem(item, blob),
    retry: () => setAttempt((n) => n + 1),
  }
}
