// 메시지 작성기 — RichInput(@멘션) 기반. Enter 전송·Shift+Enter 줄바꿈은 RichInput 이 처리.
// 한 줄 레이아웃 [＋] [입력] [보내기](WP-235). ＋ 메뉴(ComposerAttachMenu)·이미지 붙여넣기·파일 드롭 → 즉시 사전 업로드(pending 칩),
// 전송 시 fileIds 동봉. 드라이브 링크: ＋ → 드라이브에서 링크(피커는 ComposerAttachMenu 소유) → pending 칩, 전송 시 driveFileIds 동봉.
// 본문이 비어도 첨부/드라이브 링크가 있으면 전송 허용(첨부만 있는 메시지).
// 보관 채널(archived)은 입력기 대신 "보관됨" 안내만, 단순 비활성(disabled)은 입력기를 숨긴다.
import { messagingApi } from '@/api/messaging'
import { ComposerAttachmentChips } from '@/components/chat/ComposerAttachmentChips'
import { ComposerAttachMenu } from '@/components/chat/ComposerAttachMenu'
import { ComposerDropOverlay } from '@/components/chat/ComposerDropOverlay'
import { pageGutterClass } from '@/components/layout/Page'
import { convertPlaintextMentions } from '@/components/mentions/mentionSerialize'
import { RichInput } from '@/components/mentions/RichInput'
import type { MentionCandidate } from '@/components/mentions/types'
import { type PendingFile, useAttachmentDraft } from '@/hooks/useAttachmentDraft'
import { useComposerFileDrop } from '@/hooks/useComposerFileDrop'
import { MESSAGE_PLACEHOLDER } from '@/lib/submitEnter'
import { cn } from '@/lib/utils'

/** 입력창 좌우 여백 — 데스크톱은 페이지 여백(16px) 축으로 헤더 제목·메시지와 시작선을 맞추고, 모바일은 메시지 목록(max-lg:px-3)과 같은 12px 유지. */
const composerGutterClass = cn(pageGutterClass, 'max-lg:px-3')

export function MessageComposer({
  channelId,
  members,
  onSend,
  uploadFn,
  disabled = false,
  archived = false,
}: {
  // 첨부 사전 업로드 대상 채널.
  channelId: number
  // 첨부 업로드 함수 오버라이드 — 채널이 아직 없는 새 메시지 화면은 전송 시점까지 업로드를 미룬다(WP-99).
  // 생략하면 channelId 로 즉시 사전 업로드.
  uploadFn?: (files: File[]) => Promise<{ data: PendingFile[] }>
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
  // 첨부 초안 상태 — 파일 사전 업로드(pending) + 드라이브 링크(pendingDrive) + 개인 스페이스(드라이브 피커 시작 위치).
  // uploadFn 으로 팀 채팅 업로드 API 주입 (#358 공유 훅).
  const {
    pending,
    pendingDrive,
    uploading,
    hasAny,
    fileIds,
    driveFileIds,
    spacesResolved,
    personalSpaceId,
    onFiles,
    removeFile,
    removeDrive,
    addDrive,
    reset,
  } = useAttachmentDraft(uploadFn ?? ((files) => messagingApi.uploadAttachments(channelId, files)))
  // 입력창 영역 파일 드롭 → 사전 업로드(WP-235). 보관·비활성으로 입력기가 없을 땐 래퍼도 렌더되지 않는다.
  const { isDragging, dropProps } = useComposerFileDrop(onFiles)

  // 보관된 채널은 입력기를 띄우지 않고 안내만 표시(전송 자체를 차단).
  if (archived) {
    return (
      <div className={cn('border-t py-3', composerGutterClass)}>
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
    <div className={cn('relative border-t py-3', composerGutterClass)} data-testid="message-composer" {...dropProps}>
      {isDragging && <ComposerDropOverlay />}
      <ComposerAttachmentChips
        testIdPrefix="composer"
        pending={pending}
        pendingDrive={pendingDrive}
        onRemoveFile={removeFile}
        onRemoveDrive={removeDrive}
      />
      {/* 첨부/드라이브 링크가 있으면 본문이 비어도 전송 허용(allowEmptySubmit). */}
      <RichInput
        members={members}
        onSubmit={handleSubmit}
        clearOnSubmit
        allowEmptySubmit={hasAny}
        disableWhenEmpty
        placeholder={MESSAGE_PLACEHOLDER}
        submitLabel={uploading ? '업로드 중…' : '보내기'}
        submitDisabled={uploading}
        maxLength={4000}
        inlineSubmit
        onFiles={onFiles}
        leftActions={
          <ComposerAttachMenu
            testIdPrefix="composer"
            onFiles={onFiles}
            personalSpaceId={personalSpaceId}
            spacesResolved={spacesResolved}
            onAddDrive={addDrive}
          />
        }
        inputTestId="message-composer-input"
        submitTestId="message-composer-submit"
      />
    </div>
  )
}
