// 본문 이미지 추가 버튼(WP-199) — 숨은 file input 을 열어 고른 이미지를 훅에 넘긴다.
// 붙여넣기·드롭은 눈에 보이지 않는 기능이라 버튼 옆에 한 줄 안내를 함께 둔다(생성 다이얼로그·상세 편집 공용).
import { ImagePlus } from 'lucide-react'
import { useRef } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { ACCEPTED_IMAGE_TYPES } from '../../lib/imageUpload'

export function IssueBodyImageButton({
  onFiles, disabled, className,
}: { onFiles: (files: File[]) => void; disabled?: boolean; className?: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
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
        data-testid="issue-body-image-button"
      >
        <ImagePlus className="h-3.5 w-3.5" /> 이미지
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={[...ACCEPTED_IMAGE_TYPES].join(',')}
        multiple
        hidden
        data-testid="issue-body-image-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = '' // 같은 파일 재선택 허용
          if (files.length) onFiles(files)
        }}
      />
    </div>
  )
}
