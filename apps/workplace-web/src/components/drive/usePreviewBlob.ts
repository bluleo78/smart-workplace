import { useEffect, useState } from 'react'

import { driveApi } from '../../api/drive'
import { needsPreviewConfirm } from '../../lib/previewContent'

/**
 * 프리뷰용 원본 blob 을 받는 훅 — 콘텐츠 출처 선택과 10MB 초과 확인(동의)을 맡는다(WP-203).
 * 모달은 돌려받은 blob 을 종류별(이미지·PDF·텍스트·XLSX/DOCX)로 변환만 한다.
 *
 * - 목록 메타 크기가 10MB 를 넘으면 받지 않고 confirmSize 로 묻는다.
 *   FILE 크기는 업로드 때 실제 바이트로 한 번만 기록되고 바뀌지 않으므로 메타 크기로 판단한다.
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
  const [consentedKey, setConsentedKey] = useState<string | null>(null)
  const confirmSize = enabled && needsPreviewConfirm(sizeBytes, consentedKey === key) ? sizeBytes : null
  const waiting = confirmSize != null

  useEffect(() => {
    let alive = true
    // 같은 인스턴스가 파일만 바꿔 재사용되므로 이전 파일 결과를 먼저 비운다.
    setBlob(null)
    setError(false)
    // 미지원 형식이거나 동의를 기다리는 중이면 콘텐츠 요청 자체를 만들지 않는다.
    if (!enabled || waiting) return
    const fetched = contentPath ? driveApi.fetchBlobByPath(contentPath) : driveApi.fetchContentBlob(fileId)
    void fetched.then((b) => alive && setBlob(b)).catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [contentPath, fileId, enabled, waiting])

  /** 다운로드 — 헤더 버튼과 크기 확인 화면이 함께 쓴다. */
  const download = () =>
    contentPath ? driveApi.downloadByPath(contentPath, name) : driveApi.downloadFile(fileId, name)

  return { blob, error, confirmSize, confirm: () => setConsentedKey(key), download }
}
