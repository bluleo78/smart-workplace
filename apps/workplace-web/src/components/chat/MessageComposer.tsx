// 메시지 작성기 — RichInput(@멘션) 기반. Enter 전송·Shift+Enter 줄바꿈은 RichInput 이 처리.
// 파일 첨부: Paperclip 버튼 → 선택 즉시 사전 업로드(pending 칩 표시), 전송 시 fileIds 동봉.
// 드라이브 링크: Cloud 버튼 → FolderPickerModal(mode=file) → pending 칩, 전송 시 driveFileIds 동봉.
// 본문이 비어도 첨부/드라이브 링크가 있으면 전송 허용(첨부만 있는 메시지).
// 보관 채널(archived)은 입력기 대신 "보관됨" 안내만, 단순 비활성(disabled)은 입력기를 숨긴다.
import { Cloud, Paperclip, X } from 'lucide-react'

import { messagingApi } from '@/api/messaging'
import { FolderPickerModal } from '@/components/drive/FolderPickerModal'
import { convertPlaintextMentions } from '@/components/mentions/mentionSerialize'
import { RichInput } from '@/components/mentions/RichInput'
import type { MentionCandidate } from '@/components/mentions/types'
import { useAttachmentDraft } from '@/hooks/useAttachmentDraft'

export function MessageComposer({
  channelId,
  members,
  onSend,
  disabled = false,
  archived = false,
}: {
  // 첨부 사전 업로드 대상 채널.
  channelId: number
  // @멘션 후보 = 해당 채널/DM 의 구성원.
  members: MentionCandidate[]
  // 전송 성공 시 resolved Promise, 실패 시 rejected Promise 를 반환해야 한다.
  // RichInput clearOnSubmit 이 Promise 를 받아 성공 시에만 입력창을 비운다 (#169).
  onSend: (body: string, fileIds: number[], driveFileIds: number[]) => void | Promise<unknown>
  // 단순 비활성(수신자 미선택·전송중 등) — 입력기를 숨긴다(안내 문구 없음).
  disabled?: boolean
  // 보관된 채널 — "보관됨" 안내만 표시하고 입력기를 띄우지 않는다.
  archived?: boolean
}) {
  // 첨부 초안 상태 — 파일 사전 업로드(pending) + 드라이브 링크(pendingDrive) + 개인 스페이스 피커.
  // uploadFn 으로 팀 채팅 업로드 API 주입 (#358 공유 훅).
  // inputRef 를 별도 구조분해 — react-hooks/refs 가 객체 전체를 ref로 오판하는 오탐 방지.
  const {
    inputRef: attachInputRef,
    pending,
    pendingDrive,
    uploading,
    hasAny,
    fileIds,
    driveFileIds,
    spacesResolved,
    personalSpaceId,
    drivePickerOpen,
    setDrivePickerOpen,
    onFiles,
    removeFile,
    removeDrive,
    addDrive,
    reset,
  } = useAttachmentDraft((files) => messagingApi.uploadAttachments(channelId, files))

  // 보관된 채널은 입력기를 띄우지 않고 안내만 표시(전송 자체를 차단).
  if (archived) {
    return (
      <div className="border-t p-3">
        <p className="text-sm text-muted-foreground">이 채널은 보관되었습니다</p>
      </div>
    )
  }

  // 단순 비활성(수신자 미선택·전송중 등)은 입력기를 숨긴다 — "보관됨" 오표시 방지.
  if (disabled) {
    return null
  }

  // 본문·첨부·드라이브 링크 모두 비면 전송 차단. 전송 성공 시에만 pending 비움 (#169).
  // RichInput clearOnSubmit 이 반환된 Promise 를 보고 성공 시에만 입력창을 비운다.
  const handleSubmit = async (body: string): Promise<void> => {
    // #366: 평문으로 입력한 @에이전트 멘션을 <@id> 로 변환 — AI 트리거 누락 방지.
    const trimmed = convertPlaintextMentions(body, members).trim()
    if (!trimmed && !hasAny) return
    await onSend(trimmed, fileIds, driveFileIds)
    // 성공 경로에서만 도달 — 실패 시 await 에서 throw 되어 pending 도 입력창도 유지됨.
    reset()
  }

  return (
    <div className="border-t p-3" data-testid="message-composer">
      {hasAny && (
        <ul className="mb-2 flex flex-wrap gap-2" data-testid="composer-attachments">
          {pending.map((p) => (
            <li
              key={p.fileId}
              className="flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs"
            >
              <span className="max-w-[10rem] truncate">{p.originalName}</span>
              <button
                type="button"
                aria-label="첨부 제거"
                onClick={() => removeFile(p.fileId)}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
          {/* #80: 드라이브 링크 pending 칩 */}
          {pendingDrive.map((d) => (
            <li
              key={d.driveFileId}
              data-testid={`composer-drive-chip-${d.driveFileId}`}
              className="flex items-center gap-1 rounded-md border bg-info-subtle px-2 py-1 text-xs text-info"
            >
              <Cloud className="h-3 w-3" />
              <span className="max-w-[10rem] truncate">{d.name}</span>
              <button
                type="button"
                aria-label="드라이브 링크 제거"
                onClick={() => removeDrive(d.driveFileId)}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={attachInputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="composer-file-input"
        onChange={(e) => onFiles(e.target.files)}
      />
      {/* 첨부/드라이브 링크가 있으면 본문이 비어도 전송 허용(allowEmptySubmit). */}
      {/* 파일 첨부·드라이브 버튼은 RichInput 의 leftActions 로 전달 — 보내기 버튼과 같은 행에 정렬. */}
      <RichInput
        members={members}
        onSubmit={handleSubmit}
        clearOnSubmit
        allowEmptySubmit={hasAny}
        disableWhenEmpty
        placeholder="메시지를 입력하세요"
        submitLabel={uploading ? '업로드 중…' : '보내기'}
        submitDisabled={uploading}
        maxLength={4000}
        leftActions={
          <>
            <button
              type="button"
              aria-label="파일 첨부"
              data-testid="composer-attach-button"
              className="rounded-md p-2 hover:bg-accent/40"
              onClick={() => attachInputRef.current?.click()}
            >
              <Paperclip className="h-4 w-4" />
            </button>
            {/* #80: 드라이브에서 파일 링크 버튼 — spacesResolved 전에는 비활성. */}
            <button
              type="button"
              aria-label="드라이브에서 링크"
              data-testid="composer-drive-link-btn"
              disabled={!spacesResolved || personalSpaceId == null}
              title={
                spacesResolved && personalSpaceId == null
                  ? '드라이브를 사용할 수 없습니다'
                  : '드라이브에서 링크'
              }
              className="rounded-md p-2 hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => setDrivePickerOpen(true)}
            >
              <Cloud className="h-4 w-4" />
            </button>
          </>
        }
        inputTestId="message-composer-input"
        submitTestId="message-composer-submit"
      />
      {/* #80: 드라이브 파일 피커 모달 */}
      {drivePickerOpen && personalSpaceId != null && (
        <FolderPickerModal
          spaceId={personalSpaceId}
          title="링크할 파일 선택"
          mode="file"
          onPickFile={(driveFileId, name) => {
            addDrive(driveFileId, name)
            setDrivePickerOpen(false)
          }}
          onClose={() => setDrivePickerOpen(false)}
        />
      )}
    </div>
  )
}
