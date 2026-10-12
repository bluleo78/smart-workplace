// RichInput 이미지 추가 버튼(WP-362) — 숨은 file input 으로 고른 이미지를 입력창에 넘긴다.
// 붙여넣기·드롭은 눈에 보이지 않는 기능이라 넓은 화면에선 안내 문구를 함께 둔다(본문 IssueBodyImageButton 과 같은 문구).
// compact(한 줄 레이아웃)에선 에디터 왼쪽 아이콘만 — 모바일 하단 입력줄이 넘치지 않게.
import { ImagePlus } from 'lucide-react'
import { useRef } from 'react'

import { Button } from '@/components/ui/button'
import { keepFocusProps } from '@/lib/keepFocus'

import { ACCEPTED_IMAGE_TYPES } from '../../lib/imageUpload'

export function RichImageButton({
  onFiles, compact, testId,
}: { onFiles: (files: File[]) => void; compact?: boolean; testId: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={[...ACCEPTED_IMAGE_TYPES].join(',')}
      multiple
      hidden
      data-testid={`${testId}-input`}
      onChange={(e) => {
        const files = Array.from(e.target.files ?? [])
        e.target.value = '' // 같은 파일 재선택 허용
        if (files.length) onFiles(files)
      }}
    />
  )
  if (compact) {
    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0 text-muted-foreground lg:size-9"
          aria-label="이미지 추가"
          onClick={() => inputRef.current?.click()}
          {...keepFocusProps}
          data-testid={testId}
        >
          <ImagePlus className="size-5" />
        </Button>
        {input}
      </>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-9 gap-1 px-2 text-xs text-muted-foreground sm:h-7"
        onClick={() => inputRef.current?.click()}
        data-testid={testId}
      >
        <ImagePlus className="h-3.5 w-3.5" /> 이미지
      </Button>
      {/* 좁은 화면에선 줄바꿈되므로 숨긴다 */}
      <span className="hidden text-xs text-muted-foreground sm:inline">이미지를 붙여넣거나 끌어다 놓을 수 있어요</span>
      {input}
    </div>
  )
}
