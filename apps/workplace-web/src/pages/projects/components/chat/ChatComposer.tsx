// chat 메시지 작성 폼 — RichInput 래퍼 + 파일/드라이브 첨부. (#358)
// 한 줄 레이아웃 [＋] [입력] [보내기] + 이미지 붙여넣기·파일 드롭(WP-235) — 메시징 MessageComposer 와 같은 구성.
// Enter=전송(모바일 터치 셸은 줄바꿈 — lib/submitEnter), Shift+Enter=줄바꿈, @=멘션. 전송 후 비우고 포커스 유지.

import { chatApi } from '@/api/chat';
import { ComposerAttachmentChips } from '@/components/chat/ComposerAttachmentChips';
import { ComposerAttachMenu } from '@/components/chat/ComposerAttachMenu';
import { ComposerDropOverlay } from '@/components/chat/ComposerDropOverlay';
import { convertPlaintextMentions } from '@/components/mentions/mentionSerialize';
import { RichInput } from '@/components/mentions/RichInput';
import { useAttachmentDraft } from '@/hooks/useAttachmentDraft';
import { useComposerFileDrop } from '@/hooks/useComposerFileDrop';
import { useIsTouchShell } from '@/hooks/useIsTouchShell';
import { MESSAGE_PLACEHOLDER } from '@/lib/submitEnter';

import type { ChatMemberResponse } from '../../../../types/chat';

interface ChatComposerProps {
  threadId: number;
  members: ChatMemberResponse[];
  // Promise 를 반환하면 RichInput 이 성공(resolve) 시에만 입력창을 비운다 — 전송 실패 시 입력 보존(#123).
  onSubmit: (
    body: string,
    fileIds: number[],
    driveFileIds: number[],
  ) => void | Promise<unknown>;
  // 입력 중일 때마다 호출 (타이핑 송신). 호출처에서 throttle.
  onTyping?: () => void;
  // 마운트 시 입력창에 포커스(드로워로 채팅을 연 직후 바로 입력하도록).
  autoFocus?: boolean;
}

export function ChatComposer({ threadId, members, onSubmit, onTyping, autoFocus }: ChatComposerProps) {
  const {
    pending,
    pendingDrive,
    uploading,
    personalSpaceId,
    spacesResolved,
    onFiles,
    removeFile,
    removeDrive,
    addDrive,
    reset,
    hasAny,
    fileIds,
    driveFileIds,
  } = useAttachmentDraft((files) => chatApi.uploadAttachments(threadId, files));
  // 입력창 영역 파일 드롭 → 사전 업로드(WP-235).
  const { isDragging, dropProps } = useComposerFileDrop(onFiles);
  // 터치 셸은 Enter 가 줄바꿈이라(가상 키보드, M4) Shift+Enter 안내가 맞지 않는다 — 팀 채팅과 같은 문구.
  // 판정은 isSubmitEnter 와 같은 터치 셸 기준(안내 문구와 실제 키 동작이 어긋나지 않게). 그 밖은 RichInput 기본 문구.
  // TipTap 은 에디터 생성 시점의 placeholder 를 쓰므로 마운트 시 값이 적용된다.
  const touchShell = useIsTouchShell();

  // #366: 자동완성 없이 평문으로 @에이전트 를 타이핑한 경우에도 <@id> 로 변환해 AI 트리거가 누락되지 않게 한다.
  const handleSubmit = async (body: string): Promise<void> => {
    const converted = convertPlaintextMentions(body, members);
    if (!converted.trim() && !hasAny) return;
    await onSubmit(converted, fileIds, driveFileIds);
    reset();
  };

  return (
    <div className="relative border-t p-3" data-testid="chat-composer" {...dropProps}>
      {isDragging && <ComposerDropOverlay />}
      <ComposerAttachmentChips
        testIdPrefix="chat-composer"
        pending={pending}
        pendingDrive={pendingDrive}
        onRemoveFile={removeFile}
        onRemoveDrive={removeDrive}
      />
      <RichInput
        members={members}
        onSubmit={handleSubmit}
        onChange={onTyping}
        clearOnSubmit
        placeholder={touchShell ? MESSAGE_PLACEHOLDER : undefined}
        autoFocus={autoFocus}
        allowEmptySubmit={hasAny}
        disableWhenEmpty
        submitLabel={uploading ? '업로드 중…' : '보내기'}
        submitDisabled={uploading}
        maxLength={4000}
        inlineSubmit
        onFiles={onFiles}
        leftActions={
          <ComposerAttachMenu
            testIdPrefix="chat-composer"
            onFiles={onFiles}
            personalSpaceId={personalSpaceId}
            spacesResolved={spacesResolved}
            onAddDrive={addDrive}
          />
        }
        inputTestId="chat-composer-input"
        submitTestId="chat-composer-submit"
      />
    </div>
  );
}
