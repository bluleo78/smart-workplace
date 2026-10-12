// 본문 이미지 추가 버튼(WP-199) — 숨은 file input 을 열어 고른 이미지를 훅에 넘긴다.
// 붙여넣기·드롭은 눈에 보이지 않는 기능이라 버튼 옆에 한 줄 안내를 함께 둔다(생성 다이얼로그·상세 편집·코멘트 입력창 공용).
// compact(코멘트 한 줄 입력줄, WP-362)는 에디터 왼쪽 아이콘만 — 모바일 하단 입력줄이 넘치지 않게.
import { ImagePlus } from 'lucide-react'
import { useRef } from 'react'

import { Button } from '@/components/ui/button'
import { keepFocusProps } from '@/lib/keepFocus'
import { cn } from '@/lib/utils'

import { ACCEPTED_IMAGE_TYPES } from '../../lib/imageUpload'

export function IssueBodyImageButton({
  onFiles, disabled, className, compact, testId = 'issue-body-image',
}: {
  onFiles: (files: File[]) => void
  disabled?: boolean
  className?: string
  /** 아이콘만 있는 44px(데스크톱 36px) 버튼 — 입력줄 옆에 둘 때. 탭해도 입력창 포커스(=키보드)를 뺏지 않는다. */
  compact?: boolean
  /** testid 접두 — 버튼 `${testId}-button`, 숨은 input `${testId}-input`. */
  testId?: string
}) {
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
          className={cn('size-11 shrink-0 text-muted-foreground lg:size-9', className)}
          aria-label="이미지 추가"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          {...keepFocusProps}
          data-testid={`${testId}-button`}
        >
          <ImagePlus className="size-5" />
        </Button>
        {input}
      </>
    )
  }
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {/* 좁은 화면에선 라벨과 한 문장처럼 읽히고 줄바꿈되므로 숨긴다 */}
      <span className="hidden text-xs text-muted-foreground sm:inline">이미지를 붙여넣거나 끌어다 놓을 수 있어요</span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-9 gap-1 sm:h-7 px-2 text-xs text-muted-foreground"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        data-testid={`${testId}-button`}
      >
        <ImagePlus className="h-3.5 w-3.5" /> 이미지
      </Button>
      {input}
    </div>
  )
}
