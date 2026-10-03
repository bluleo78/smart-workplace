import { useEffect, useRef, useState } from 'react'

import { driveApi } from '../../api/drive'
import { downloadBlob } from '../../lib/download'
import { needsPreviewConfirm } from '../../lib/previewContent'

/**
 * 프리뷰용 원본 blob 을 받는 훅 — 콘텐츠 출처 선택, 10MB 초과 확인(동의), 받기 전·후 크기 판정을 맡는다(WP-203).
 * 모달은 돌려받은 blob 을 종류별(이미지·PDF·텍스트·XLSX/DOCX)로 변환만 한다.
 *
 * - 메타 크기가 10MB 를 넘으면 받지 않고 confirmSize 로 묻는다.
 * - 메타 크기는 작았는데 받아보니 넘으면 그 blob 을 보관하고 묻는다 — 동의·다운로드 때 다시 받지 않는다.
 * - 동의는 콘텐츠 키별이라 다른 파일로 바뀌면 자동으로 다시 묻는다.
 */
export function usePreviewBlob({
  contentPath,
  fileId,
  sizeBytes,
  name,
  enabled,
}: {
  /** 첨부 콘텐츠 경로. null 이면 드라이브 파일 엔드포인트(fileId) 사용. */
  contentPath: string | null
  fileId: number
  sizeBytes: number | null
  name: string
  /** 미리볼 수 있는 형식일 때만 받는다. */
  enabled: boolean
}) {
  const key = contentPath ?? `drive:${fileId}`
  const [blob, setBlob] = useState<Blob | null>(null)
  const [error, setError] = useState(false)
  // 받은 뒤에야 10MB 초과를 안 경우의 실제 크기. 메타 크기 초과는 렌더 중 바로 계산한다.
  const [fetchedOversize, setFetchedOversize] = useState<number | null>(null)
  const [consentedKey, setConsentedKey] = useState<string | null>(null)
  const consented = consentedKey === key
  // 받아보니 큰 blob — 동의·다운로드 때 재사용. 파일이 바뀌면 버린다(큰 blob 을 붙잡고 있지 않게).
  const pendingRef = useRef<{ key: string; blob: Blob } | null>(null)

  const metaOversize = enabled && needsPreviewConfirm(sizeBytes, consented)
  const confirmSize = metaOversize ? sizeBytes : fetchedOversize

  useEffect(() => {
    let alive = true
    // 같은 인스턴스가 파일만 바꿔 재사용되므로 이전 파일 결과를 먼저 비운다.
    setBlob(null)
    setError(false)
    setFetchedOversize(null)
    if (pendingRef.current?.key !== key) pendingRef.current = null
    if (!enabled || metaOversize) return
    const pending = pendingRef.current?.blob
    pendingRef.current = null
    const fetched = pending
      ? Promise.resolve(pending)
      : contentPath
        ? driveApi.fetchBlobByPath(contentPath)
        : driveApi.fetchContentBlob(fileId)
    void fetched
      .then((b) => {
        if (!alive) return
        // 받은 실제 크기로 한 번 더 본다 — 메타 크기가 null 이거나 실제와 다를 수 있다(파일 교체 등).
        if (needsPreviewConfirm(b.size, consented)) {
          pendingRef.current = { key, blob: b }
          setFetchedOversize(b.size)
        } else {
          setBlob(b)
        }
      })
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [key, contentPath, fileId, enabled, metaOversize, consented])

  /** 다운로드 — 이미 받아 둔 blob 이 있으면 다시 받지 않는다. */
  const download = () => {
    const pending = pendingRef.current?.key === key ? pendingRef.current.blob : null
    if (pending) return downloadBlob(name, pending)
    return contentPath ? driveApi.downloadByPath(contentPath, name) : driveApi.downloadFile(fileId, name)
  }

  return { blob, error, confirmSize, confirm: () => setConsentedKey(key), download }
}
