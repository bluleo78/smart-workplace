// 채팅 입력창의 ＋ 첨부 메뉴 (WP-235) — 한 줄 입력창 [＋] [입력] [보내기] 의 ＋.
// 데스크톱: 팝오버(파일 첨부·드라이브에서 링크). 모바일: 바텀시트(카메라로 찍기·사진 보관함·파일·드라이브에서 링크).
// 파일 선택 input 과 드라이브 파일 피커(#80)를 이 컴포넌트가 소유한다 — 카메라(capture)·사진(image/*)·일반 파일은 각각 다른 input.
// 메시징(MessageComposer)·이슈 챗(ChatComposer)이 공유하고, 메인 AI 채팅(WP-234)은 드라이브 props 없이 aboveAiSheet 로 재사용한다.
import { Camera, Cloud, Image as ImageIcon, Paperclip, Plus } from 'lucide-react';
import { type ChangeEvent, useRef, useState } from 'react';

import { FolderPickerModal } from '@/components/drive/FolderPickerModal';
import { MobileActionSheet } from '@/components/mobile/MobileActionSheet';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useIsMobile } from '@/hooks/useIsMobile';

export function ComposerAttachMenu({
  testIdPrefix,
  onFiles,
  personalSpaceId,
  spacesResolved,
  onAddDrive,
  aboveAiSheet = false,
}: {
  /** testid 접두사 — 기존 E2E 와 맞춰 메시징은 'composer', 이슈 챗은 'chat-composer'. */
  testIdPrefix: string;
  /** 선택한 파일(사진·카메라 포함) — 호출처가 사전 업로드한다. */
  onFiles: (files: File[]) => void;
  /** 드라이브 피커 시작 위치(개인 스페이스). 미확인·없음이면 드라이브 항목을 숨기지 않고 비활성으로 둔다. */
  personalSpaceId?: number | null;
  spacesResolved?: boolean;
  /**
   * 드라이브 파일 링크 추가. 이 콜백이 있어야 「드라이브에서 링크」를 보인다 — 메인 AI 채팅은 드라이브 링크를 받지 않아
   * 드라이브 props 를 모두 생략한다(WP-234).
   */
  onAddDrive?: (driveFileId: number, name: string) => void;
  /** AI 시트(z-[60]) 안에서 쓸 때 true — body 포털(z-50)인 메뉴·바텀시트(딤 포함)를 z-[80] 으로 올린다(WP-234). */
  aboveAiSheet?: boolean;
}) {
  const isMobile = useIsMobile();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const drive = onAddDrive != null;
  const driveDisabled = !spacesResolved || personalSpaceId == null;

  // 세 input 공용 — 같은 파일을 다시 고를 수 있게 값을 비운 뒤 넘긴다.
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length > 0) onFiles(files);
  };

  // 트리거는 모바일 시트·데스크톱 메뉴 공용 — 모바일은 44px 원형, 데스크톱은 36px. 📎·☁︎ 를 합친 유일한 첨부 진입점이라 muted 보다 진하게.
  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="text-foreground/70 hover:text-foreground max-lg:size-11 max-lg:rounded-full"
      title="첨부 추가"
      aria-label="첨부 추가"
      data-testid={`${testIdPrefix}-attach-button`}
      onClick={isMobile ? () => setSheetOpen(true) : undefined}
    >
      <Plus className="size-4 max-lg:size-5" aria-hidden />
    </Button>
  );

  return (
    <>
      {isMobile ? (
        // 시트가 열리며 에디터 포커스가 빠져 키보드가 내려간다(시트·키보드 동시 표시 금지 원칙).
        <>
          {trigger}
          <MobileActionSheet
            testId={`${testIdPrefix}-attach-sheet`}
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            title="첨부"
            aboveAiSheet={aboveAiSheet}
            actions={[
              { key: 'camera', label: '카메라로 찍기', icon: <Camera />, onSelect: () => cameraRef.current?.click() },
              { key: 'photo', label: '사진 보관함', icon: <ImageIcon />, onSelect: () => photoRef.current?.click() },
              { key: 'file', label: '파일', icon: <Paperclip />, onSelect: () => fileRef.current?.click() },
              ...(drive
                ? [{ key: 'drive', label: '드라이브에서 링크', icon: <Cloud />, onSelect: () => setPickerOpen(true), disabled: driveDisabled }]
                : []),
            ]}
          />
        </>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className={aboveAiSheet ? 'z-[80]' : undefined} data-testid={`${testIdPrefix}-attach-menu`}>
            <DropdownMenuItem data-testid={`${testIdPrefix}-attach-file`} onSelect={() => fileRef.current?.click()}>
              <Paperclip /> 파일 첨부
            </DropdownMenuItem>
            {drive && (
              <DropdownMenuItem
                data-testid={`${testIdPrefix}-drive-link-btn`}
                disabled={driveDisabled}
                title={driveDisabled ? '드라이브를 사용할 수 없습니다' : undefined}
                onSelect={() => setPickerOpen(true)}
              >
                <Cloud /> 드라이브에서 링크
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <input ref={fileRef} type="file" multiple hidden data-testid={`${testIdPrefix}-file-input`} onChange={handleChange} />
      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-testid={`${testIdPrefix}-photo-input`}
        onChange={handleChange}
      />
      {/* capture=environment — 모바일에서 후면 카메라 촬영으로 바로 연다(데스크톱 브라우저는 무시). */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-testid={`${testIdPrefix}-camera-input`}
        onChange={handleChange}
      />
      {drive && pickerOpen && personalSpaceId != null && (
        <FolderPickerModal
          spaceId={personalSpaceId}
          title="링크할 파일 선택"
          mode="file"
          onPickFile={(driveFileId, name) => {
            onAddDrive?.(driveFileId, name);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  );
}
