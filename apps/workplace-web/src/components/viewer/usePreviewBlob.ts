import { useEffect, useState } from 'react'

import { driveApi } from '../../api/drive'
import { needsPreviewConfirm } from '../../lib/previewContent'
import { downloadViewerItem } from './downloadViewerItem'
import type { ViewerItem } from './types'

/**
 * 미리보기 원본 blob 받기 + 10MB 초과 확인(WP-203 → WP-277 이동).
 * 항목이 바뀌면(넘김) 이전 결과를 비우고, 늦게 온 이전 응답은 alive 가드로 버린다.
 * 동의는 항목 key 별 — 다른 파일로 넘기면 다시 묻는다.
 */
export function usePreviewBlob(item: ViewerItem, enabled: boolean) {
  const [blob, setBlob] = useState<Blob | null>(null)
  const [error, setError] = useState(false)
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
    if (!active || waiting) return
    driveApi
      .fetchBlobByPath(item.contentPath)
      .then((b) => alive && setBlob(b))
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [item.contentPath, active, waiting, attempt])

  return {
    blob,
    error,
    confirmSize,
    confirm: () => setConsentedKey(item.key),
    download: () => downloadViewerItem(item),
    retry: () => setAttempt((n) => n + 1),
  }
}
