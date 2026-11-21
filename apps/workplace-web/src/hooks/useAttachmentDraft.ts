import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { SPACES_ERROR_MESSAGE, useDriveSpaces } from '@/hooks/queries/useDriveSpaces'
import { handleApiError } from '@/lib/api-error'
import { ATTACHMENT_MAX_BYTES, checkDraftFileCount, oversizeFileMessage } from '@/lib/attachmentLimits'

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
 * options.drive=false(메인 AI 채팅, WP-234)면 드라이브 링크를 받지 않으므로 스페이스를 조회하지 않는다 — 기본 true.
 * options.rejectOversize=true 면 25MB 를 넘는 파일을 올리기 전에 빼고 파일마다 안내한다(WP-848) — 끝까지 올린 뒤에야 서버가
 * 거절해 쓸모없는 업로드를 기다리게 했다. 메인 AI 채팅은 이미지를 줄인 뒤 크기를 따로 보므로 켜지 않는다.
 * options.maxFiles 가 있으면 초안 칩 + 업로드 중 파일 + 이번 묶음이 그 수를 넘을 때 올리기 전에 묶음째 거절하고 남은 자리를 알린다(WP-1857)
 * — 나눠 붙여 한도를 넘기면 전송 때 서버가 409 로 막던 것을 앞당긴다. 25MB 거름 뒤 남은 파일로 센다.
 */
export function useAttachmentDraft(
  uploadFn: (files: File[]) => Promise<{ data: PendingFile[] }>,
  options: { drive?: boolean; rejectOversize?: boolean; maxFiles?: number } = {},
) {
  const drive = options.drive ?? true
  const [pending, setPending] = useState<PendingFile[]>([])
  const [pendingDrive, setPendingDrive] = useState<PendingDriveFile[]>([])
  // 진행 중 업로드 수 — 붙여넣기·드롭·＋ 로 업로드가 겹칠 수 있어(WP-235) on/off 플래그 대신 센다.
  // 먼저 끝난 업로드가 플래그를 꺼 버리면 다른 업로드 도중 전송이 열려 늦은 파일이 다음 메시지로 새어 나간다.
  const [inFlight, setInFlight] = useState(0)
  // 개수 판정용 동기 원본(WP-1857) — 칩 배열은 ref 에 두고 pending 은 commitPending 으로만 바꾼다(ref 먼저, state 는 그대로 전달).
  // state·updater 는 같은 틱에 겹친 묶음에서 낡은 값을 주기 때문이다. queued = 아직 응답을 못 받은 업로드 파일 수.
  const pendingRef = useRef<PendingFile[]>([])
  const queued = useRef(0)
  const commitPending = (next: PendingFile[]) => {
    pendingRef.current = next
    setPending(next)
  }
  const [personalSpaceId, setPersonalSpaceId] = useState<number | null>(null)
  // 드라이브를 쓰지 않으면 처음부터 '확인 끝·개인 스페이스 없음'이다(조회 안 함).
  const [spacesResolved, setSpacesResolved] = useState(!drive)

  // PERSONAL 스페이스 조회 — 드라이브 피커 시작 위치. queryKey 공유로 IssueAttachmentStrip 등
  // 동일 이슈 화면에 동시 마운트되는 다른 컴포넌트와 요청이 dedup 된다 (#798).
  // 쿼리가 꺼지면 isSuccess·isError 가 모두 false 라 아래 effect 는 바로 return 한다.
  const spacesQuery = useDriveSpaces({ enabled: drive })
  useEffect(() => {
    if (!spacesQuery.isSuccess && !spacesQuery.isError) return
    if (spacesQuery.isError) {
      setSpacesResolved(true)
      toast.error(SPACES_ERROR_MESSAGE)
      return
    }
    const personal = spacesQuery.data.find((s) => s.type === 'PERSONAL')
    if (personal) setPersonalSpaceId(personal.id)
    setSpacesResolved(true)
  }, [spacesQuery.isSuccess, spacesQuery.isError, spacesQuery.data])

  // 파일 선택·붙여넣기·드롭 공용 진입점 — FileList(input) 와 File[](paste/drop, WP-235) 모두 받는다.
  const onFiles = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return
    let list = Array.from(files)
    if (options.rejectOversize) {
      for (const f of list) if (f.size > ATTACHMENT_MAX_BYTES) toast.error(oversizeFileMessage(f.name))
      list = list.filter((f) => f.size <= ATTACHMENT_MAX_BYTES)
      if (list.length === 0) return
    }
    // 개수 한도 — 넘으면 묶음째 올리지 않는다. 고정 id 로 연달아 거절돼도 토스트는 한 장만 보인다(WP-1842 와 같은 방식).
    const check =
      options.maxFiles === undefined
        ? undefined
        : checkDraftFileCount(list.length, pendingRef.current.length + queued.current, options.maxFiles)
    if (check && !check.ok) {
      toast.error(check.message, { id: 'attachment-count-limit' })
      return
    }
    queued.current += list.length
    setInFlight((n) => n + 1)
    try {
      const { data } = await uploadFn(list)
      // finally 가 queued 를 내리기 전에 칩으로 옮겨 두 집계 사이에 틈이 없게 한다.
      commitPending([...pendingRef.current, ...data])
    } catch (err) {
      handleApiError(err, '첨부 업로드에 실패했습니다')
    } finally {
      queued.current -= list.length
      setInFlight((n) => n - 1)
    }
  }

  const removeFile = (fileId: number) => {
    commitPending(pendingRef.current.filter((x) => x.fileId !== fileId))
  }
  const removeDrive = (driveFileId: number) =>
    setPendingDrive((prev) => prev.filter((x) => x.driveFileId !== driveFileId))
  const addDrive = (driveFileId: number, name: string) =>
    setPendingDrive((prev) =>
      prev.some((x) => x.driveFileId === driveFileId) ? prev : [...prev, { driveFileId, name }],
    )
  /** 초안을 통째로 비운다 — 대화 전환처럼 전부 버릴 때만 쓴다. 전송 성공 뒤에는 commitSent(전송 중 붙인 칩 유지, WP-1868). */
  const reset = () => {
    commitPending([])
    setPendingDrive([])
  }
  /**
   * 전송 성공 뒤 보낸 것만 뺀다 — 전송 중 새로 붙인 칩을 지우지 않게(WP-1868). reset() 은 전부 비우므로 그 칩까지 잃는다.
   * 칩 원본은 ref 라 전송 중 늘어난 칩도 반영된 최신 배열에서 거른다. 이미 지운 id 가 섞여도 무해하다.
   */
  const commitSent = (sentFileIds: number[], sentDriveFileIds: number[]) => {
    commitPending(pendingRef.current.filter((p) => !sentFileIds.includes(p.fileId)))
    setPendingDrive((prev) => prev.filter((d) => !sentDriveFileIds.includes(d.driveFileId)))
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
    commitSent,
    hasAny: pending.length > 0 || pendingDrive.length > 0,
    fileIds: pending.map((p) => p.fileId),
    driveFileIds: pendingDrive.map((d) => d.driveFileId),
  }
}
