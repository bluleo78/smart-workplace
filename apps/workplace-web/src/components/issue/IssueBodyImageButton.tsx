// 본문 이미지 추가 버튼(WP-199) — 숨은 file input 을 열어 고른 이미지를 훅에 넘긴다.
import { ImagePlus } from 'lucide-react'
import { useRef } from 'react'

import { Button } from '@/components/ui/button'

export function IssueBodyImageButton({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 gap-1 px-2 text-xs text-muted-foreground"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        data-testid="issue-body-image-button"
      >
        <ImagePlus className="h-3.5 w-3.5" /> 이미지
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        data-testid="issue-body-image-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = '' // 같은 파일 재선택 허용
          if (files.length) onFiles(files)
        }}
      />
    </>
  )
}
