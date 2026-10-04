import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { useDriveSpaces } from '@/hooks/queries/useDriveSpaces'
import { handleApiError } from '@/lib/api-error'

export type PendingFile = {
  fileId: number
  originalName: string
  mimeType: string
  sizeBytes: number
}
export type PendingDriveFile = { driveFileId: number; name: string }

/**
 * 첨부 초안 상태 훅 — 파일 사전 업로드(pending) + 드라이브 링크(pendingDrive) + 개인 스페이스(드라이브 피커 시작 위치).
 * MessageComposer(팀 채팅)·ChatComposer(이슈 채팅)가 공유. uploadFn 으로 도메인별 업로드 API 주입. (#358)
 */
export function useAttachmentDraft(
  uploadFn: (files: File[]) => Promise<{ data: PendingFile[] }>,
) {
  const [pending, setPending] = useState<PendingFile[]>([])
  const [pendingDrive, setPendingDrive] = useState<PendingDriveFile[]>([])
  // 진행 중 업로드 수 — 붙여넣기·드롭·＋ 로 업로드가 겹칠 수 있어(WP-235) on/off 플래그 대신 센다.
  // 먼저 끝난 업로드가 플래그를 꺼 버리면 다른 업로드 도중 전송이 열려 늦은 파일이 다음 메시지로 새어 나간다.
  const [inFlight, setInFlight] = useState(0)
  const [personalSpaceId, setPersonalSpaceId] = useState<number | null>(null)
  const [spacesResolved, setSpacesResolved] = useState(false)

  // PERSONAL 스페이스 조회 — 드라이브 피커 시작 위치. queryKey 공유로 IssueAttachmentStrip 등
  // 동일 이슈 화면에 동시 마운트되는 다른 컴포넌트와 요청이 dedup 된다 (#798).
  const spacesQuery = useDriveSpaces()
  useEffect(() => {
    if (!spacesQuery.isSuccess && !spacesQuery.isError) return
    if (spacesQuery.isError) {
      setSpacesResolved(true)
      toast.error('드라이브 스페이스를 불러오지 못했습니다.')
      return
    }
    const personal = spacesQuery.data.find((s) => s.type === 'PERSONAL')
    if (personal) setPersonalSpaceId(personal.id)
    setSpacesResolved(true)
  }, [spacesQuery.isSuccess, spacesQuery.isError, spacesQuery.data])

  // 파일 선택·붙여넣기·드롭 공용 진입점 — FileList(input) 와 File[](paste/drop, WP-235) 모두 받는다.
  const onFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return
    setInFlight((n) => n + 1)
    try {
      const { data } = await uploadFn(Array.from(files))
      setPending((prev) => [...prev, ...data])
    } catch (err) {
      handleApiError(err, '첨부 업로드에 실패했습니다')
    } finally {
      setInFlight((n) => n - 1)
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
    uploading: inFlight > 0,
    personalSpaceId,
    spacesResolved,
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
