// chat 메시지 작성 폼 — RichInput 래퍼 + 파일/드라이브 첨부. (#358)
// Enter=전송, Shift+Enter=줄바꿈, @=멘션. 전송 후 비우고 포커스 유지.

import { Cloud, Paperclip, X } from 'lucide-react';

import { chatApi } from '@/api/chat';
import { FolderPickerModal } from '@/components/drive/FolderPickerModal';
import { convertPlaintextMentions } from '@/components/mentions/mentionSerialize';
import { RichInput } from '@/components/mentions/RichInput';
import { useAttachmentDraft } from '@/hooks/useAttachmentDraft';

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
}

export function ChatComposer({ threadId, members, onSubmit, onTyping }: ChatComposerProps) {
  // inputRef 를 별도 구조분해 — react-hooks/refs 가 객체 전체를 ref로 오판하는 오탐 방지.
  const {
    inputRef: attachInputRef,
    pending,
    pendingDrive,
    uploading,
    personalSpaceId,
    spacesResolved,
    drivePickerOpen,
    setDrivePickerOpen,
    onFiles,
    removeFile,
    removeDrive,
    addDrive,
    reset,
    hasAny,
    fileIds,
    driveFileIds,
  } = useAttachmentDraft((files) => chatApi.uploadAttachments(threadId, files));

  // #366: 자동완성 없이 평문으로 @에이전트 를 타이핑한 경우에도 <@id> 로 변환해 AI 트리거가 누락되지 않게 한다.
  const handleSubmit = async (body: string): Promise<void> => {
    const converted = convertPlaintextMentions(body, members);
    if (!converted.trim() && !hasAny) return;
    await onSubmit(converted, fileIds, driveFileIds);
    reset();
  };

  return (
    <div className="border-t p-3" data-testid="chat-composer">
      {/* 업로드 대기 중인 첨부 파일 + 드라이브 링크 칩 목록 */}
      {hasAny && (
        <ul className="mb-2 flex flex-wrap gap-2" data-testid="chat-composer-attachments">
          {pending.map((p) => (
            <li
              key={p.fileId}
              className="flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-xs"
            >
              <span className="max-w-[10rem] truncate">{p.originalName}</span>
              <button type="button" aria-label="첨부 제거" onClick={() => removeFile(p.fileId)}>
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
          {pendingDrive.map((d) => (
            <li
              key={d.driveFileId}
              data-testid={`chat-composer-drive-chip-${d.driveFileId}`}
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
      {/* 숨김 파일 입력 — Paperclip 버튼 클릭 시 트리거 */}
      <input
        ref={attachInputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="chat-composer-file-input"
        onChange={(e) => onFiles(e.target.files)}
      />
      <RichInput
        members={members}
        onSubmit={handleSubmit}
        onChange={onTyping}
        clearOnSubmit
        allowEmptySubmit={hasAny}
        disableWhenEmpty
        submitLabel={uploading ? '업로드 중…' : '보내기'}
        submitDisabled={uploading}
        maxLength={4000}
        leftActions={
          <>
            {/* 파일 첨부 버튼 */}
            <button
              type="button"
              aria-label="파일 첨부"
              data-testid="chat-composer-attach-button"
              className="rounded-md p-2 hover:bg-accent/40"
              onClick={() => attachInputRef.current?.click()}
            >
              <Paperclip className="h-4 w-4" />
            </button>
            {/* 드라이브에서 링크 버튼 — 개인 스페이스 미확인 시 비활성 */}
            <button
              type="button"
              aria-label="드라이브에서 링크"
              data-testid="chat-composer-drive-link-btn"
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
        inputTestId="chat-composer-input"
        submitTestId="chat-composer-submit"
      />
      {/* 드라이브 파일 피커 모달 — 개인 스페이스 기준 (#358) */}
      {drivePickerOpen && personalSpaceId != null && (
        <FolderPickerModal
          spaceId={personalSpaceId}
          title="링크할 파일 선택"
          mode="file"
          onPickFile={(driveFileId, name) => {
            addDrive(driveFileId, name);
            setDrivePickerOpen(false);
          }}
          onClose={() => setDrivePickerOpen(false)}
        />
      )}
    </div>
  );
}
