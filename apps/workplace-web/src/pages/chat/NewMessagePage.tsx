// 인라인 "새 메시지" compose — 모달 대신 대화 영역 전체를 차지(Slack 패턴).
// 상단 "받는 사람:" 인라인 검색 입력(RecipientInput, 본인 제외), 하단 MessageComposer.
// 첫 전송 시 find-or-create DM → (첨부 있으면) 그 DM 으로 업로드 → 메시지 전송 → /chat/dms/{id} 이동.
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { messagingApi } from '@/api/messaging'
import { MessageComposer } from '@/components/chat/MessageComposer'
import { RecipientInput } from '@/components/chat/RecipientInput'
import type { MentionCandidate } from '@/components/mentions/types'
import { useCreateDm } from '@/hooks/queries/useCreateDm'
import type { MemberPickerCandidate } from '@/hooks/queries/useUserSearch'
import type { PendingFile } from '@/hooks/useAttachmentDraft'
import { useAuth } from '@/hooks/useAuth'
import { handleApiError } from '@/lib/api-error'

// 본인 포함 최대 8명 → 타겟 최대 7명.
const MAX_TARGETS = 7

export default function NewMessagePage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const myId = user?.id ?? 0
  const createDm = useCreateDm()
  const [selected, setSelected] = useState<MemberPickerCandidate[]>([])
  const [sending, setSending] = useState(false)
  // 전송 전까지 보관하는 첨부(임시 음수 id → 원본 File + 업로드 결과). DM 이 아직 없어 사전 업로드할 채널이 없기 때문(WP-99).
  // uploaded 는 업로드 후 메시지 전송만 실패했을 때 재시도에서 같은 파일을 다시 올려 고아 파일이 쌓이지 않게 한다
  // (수신자가 바뀌어 DM 이 달라지면 재업로드).
  const heldFiles = useRef(
    new Map<number, { file: File; uploaded?: { dmId: number; fileId: number } }>(),
  )
  const nextTempId = useRef(-1)

  // @멘션 후보 — 선택된 수신자들을 채널 멤버로 전달
  const members: MentionCandidate[] = selected.map((u) => ({
    userId: u.id,
    username: u.username,
    name: u.name,
    kind: u.kind,
  }))

  const addRecipient = (u: MemberPickerCandidate) => {
    setSelected((prev) =>
      prev.some((p) => p.id === u.id) || prev.length >= MAX_TARGETS ? prev : [...prev, u],
    )
  }
  const removeRecipient = (id: number) => setSelected((prev) => prev.filter((u) => u.id !== id))

  // 첨부 "업로드" 대신 파일을 보관만 하고 임시 id 로 pending 칩을 띄운다 — 실제 업로드는 handleSend 에서.
  const holdFiles = async (files: File[]): Promise<{ data: PendingFile[] }> => ({
    data: files.map((f) => {
      const fileId = nextTempId.current--
      heldFiles.current.set(fileId, { file: f })
      return { fileId, originalName: f.name, mimeType: f.type, sizeBytes: f.size }
    }),
  })

  // 첫 전송: DM find-or-create → 보관한 첨부를 그 DM 으로 업로드 → 메시지 전송 → DM 페이지로 이동
  const handleSend = async (body: string, fileIds: number[], driveFileIds: number[]) => {
    if (selected.length === 0 || sending) return
    setSending(true)
    // DM find-or-create — 실패 시 useCreateDm.onError 가 토스트하므로 여기선 토스트 없이 중단.
    // 실패는 reject 로 전파 — MessageComposer 가 성공으로 오인해 보관 중인 첨부 칩을 비우지 않게 한다.
    let dm
    try {
      dm = await createDm.mutateAsync(selected.map((u) => u.id))
    } catch (err) {
      setSending(false)
      throw err
    }
    // 첨부 업로드 + 첫 메시지 전송 — 이 호출들은 hook-level onError 가 없으므로 여기서 처리.
    try {
      // 칩에서 제거돼 fileIds 에 없는 보관분은 버리고, 남은 것 중 이 DM 에 아직 안 올린 것만 업로드한다.
      const held = heldFiles.current
      for (const id of held.keys()) if (!fileIds.includes(id)) held.delete(id)
      const toUpload = fileIds.filter((id) => held.get(id)!.uploaded?.dmId !== dm.id)
      if (toUpload.length) {
        const { data } = await messagingApi.uploadAttachments(
          dm.id,
          toUpload.map((id) => held.get(id)!.file),
        )
        // 업로드 응답은 요청 순서와 같다 — 임시 id 와 순서대로 매핑.
        data.forEach((f, i) => {
          held.get(toUpload[i])!.uploaded = { dmId: dm.id, fileId: f.fileId }
        })
      }
      const uploadedIds = fileIds.flatMap((id) => held.get(id)!.uploaded?.fileId ?? [])
      await messagingApi.createMessage(dm.id, {
        body,
        fileIds: uploadedIds.length ? uploadedIds : undefined,
        driveFileIds: driveFileIds.length ? driveFileIds : undefined,
      })
      navigate(`/chat/dms/${dm.id}`)
    } catch (err) {
      handleApiError(err, '메시지를 보낼 수 없습니다')
      setSending(false)
      throw err
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="new-message-page">
      <header className="border-b px-4 py-2">
        <div className="text-sm font-semibold">새 메시지</div>
        <div className="mt-2">
          {/* 진입 즉시 상대를 고를 수 있게 자동 포커스 — 포커스되면 후보 목록이 바로 열린다(#883). */}
          <RecipientInput
            selected={selected}
            onAdd={addRecipient}
            onRemove={removeRecipient}
            max={MAX_TARGETS}
            excludeUserIds={new Set([myId])}
            autoFocus
          />
        </div>
      </header>

      {/* 수신자 없으면 안내 문구, 있으면 첫 메시지 작성 안내 */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
        {selected.length === 0
          ? '받는 사람을 추가하면 대화를 시작할 수 있어요.'
          : '첫 메시지를 입력해 대화를 시작하세요.'}
      </div>

      {/* channelId=0: DM 이 아직 없으므로 첨부는 holdFiles 로 보관만 하고 전송 시 업로드한다(WP-99). */}
      <MessageComposer
        channelId={0}
        uploadFn={holdFiles}
        members={members}
        // sending 은 disabled 에 넣지 않는다 — 넣으면 전송 중 입력기가 언마운트돼 실패 시 본문이 사라진다.
        // 중복 전송은 handleSend 의 sending 가드와 RichInput 의 제출 중 가드가 막는다.
        disabled={selected.length === 0}
        onSend={handleSend}
      />
    </div>
  )
}
