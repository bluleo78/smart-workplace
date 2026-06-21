import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { driveApi } from '@/api/drive'
import { handleApiError } from '@/lib/api-error'
import type { DriveSpace } from '@/types/drive'

export type PendingFile = {
  fileId: number
  originalName: string
  mimeType: string
  sizeBytes: number
}
export type PendingDriveFile = { driveFileId: number; name: string }

/**
 * 첨부 초안 상태 훅 — 파일 사전 업로드(pending) + 드라이브 링크(pendingDrive) + 개인 스페이스 피커.
 * MessageComposer(팀 채팅)·ChatComposer(이슈 채팅)가 공유. uploadFn 으로 도메인별 업로드 API 주입. (#358)
 */
export function useAttachmentDraft(
  uploadFn: (files: File[]) => Promise<{ data: PendingFile[] }>,
) {
  const [pending, setPending] = useState<PendingFile[]>([])
  const [pendingDrive, setPendingDrive] = useState<PendingDriveFile[]>([])
  const [uploading, setUploading] = useState(false)
  const [personalSpaceId, setPersonalSpaceId] = useState<number | null>(null)
  const [spacesResolved, setSpacesResolved] = useState(false)
  const [drivePickerOpen, setDrivePickerOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 마운트 시 PERSONAL 스페이스 조회 — 드라이브 피커 시작 위치.
  useEffect(() => {
    void driveApi
      .listSpaces()
      .then(({ data }) => {
        const personal = (data as DriveSpace[]).find((s) => s.type === 'PERSONAL')
        if (personal) setPersonalSpaceId(personal.id)
        setSpacesResolved(true)
      })
      .catch(() => {
        setSpacesResolved(true)
        toast.error('드라이브 스페이스를 불러오지 못했습니다.')
      })
  }, [])

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      const { data } = await uploadFn(Array.from(files))
      setPending((prev) => [...prev, ...data])
    } catch (err) {
      handleApiError(err, '첨부 업로드에 실패했습니다')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const removeFile = (fileId: number) =>
    setPending((prev) => prev.filter((x) => x.fileId !== fileId))
  const removeDrive = (driveFileId: number) =>
    setPendingDrive((prev) => prev.filter((x) => x.driveFileId !== driveFileId))
  const addDrive = (driveFileId: number, name: string) =>
    setPendingDrive((prev) =>
      prev.some((x) => x.driveFileId === driveFileId) ? prev : [...prev, { driveFileId, name }],
    )
  const reset = () => {
    setPending([])
    setPendingDrive([])
  }

  return {
    pending,
    pendingDrive,
    uploading,
    personalSpaceId,
    spacesResolved,
    drivePickerOpen,
    setDrivePickerOpen,
    inputRef,
    onFiles,
    removeFile,
    removeDrive,
    addDrive,
    reset,
    hasAny: pending.length > 0 || pendingDrive.length > 0,
    fileIds: pending.map((p) => p.fileId),
    driveFileIds: pendingDrive.map((d) => d.driveFileId),
  }
}
