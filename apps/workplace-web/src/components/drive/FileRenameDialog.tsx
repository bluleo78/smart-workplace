// 드라이브 파일 이름 변경 다이얼로그(WP-335).
// 무엇을: 전체 이름을 한 칸에 보여 주고, 열릴 때 확장자 앞까지만 선택해 바로 타이핑하면 이름만 바뀌게 한다(Google Drive·Finder 방식).
//        확장자도 칸 안에 있어 필요하면 직접 고칠 수 있다.
// 왜: 확장자를 고정하면 잘못 올라간 확장자(.jpeg→.jpg 등)를 고칠 수 없고, 전체 선택이면 타이핑 한 번에 확장자가 날아간다.
//     이름 중복(409) 등 실패는 다이얼로그를 닫지 않고 인라인으로 알려 바로 고치게 한다(공간 이름 변경과 같은 방식).
import axios from 'axios'
import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useSingleLineEnter } from '@/hooks/useSingleLineEnter'
import { extractApiError } from '@/lib/api-error'
import { fileStemLength } from '@/lib/fileName'

interface RenameTarget {
  id: number
  name: string
}

interface FileRenameDialogProps {
  /** 이름을 바꿀 파일 — null 이면 닫힘 */
  file: RenameTarget | null
  /** 새 이름 저장 — 실패하면 throw 해 다이얼로그가 인라인 에러로 보여 준다 */
  onSubmit: (fileId: number, name: string) => Promise<void>
  onClose: () => void
}

export function FileRenameDialog({ file, onSubmit, onClose }: FileRenameDialogProps) {
  return (
    <Dialog open={file != null} onOpenChange={(open) => { if (!open) onClose() }}>
      {/* 파일마다 key 로 다시 마운트해 입력값·에러를 현재 이름으로 초기화한다. */}
      {file && <RenameContent key={file.id} file={file} onSubmit={onSubmit} onClose={onClose} />}
    </Dialog>
  )
}

function RenameContent({ file, onSubmit, onClose }: { file: RenameTarget } & Omit<FileRenameDialogProps, 'file'>) {
  const [value, setValue] = useState(file.name)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Enter 저장 — 한글 조합 Enter·macOS Chrome 확정 직후 꼬리 Enter 는 저장으로 보지 않는다(WP-331).
  const enterKey = useSingleLineEnter()

  async function submit() {
    if (submitting) return
    const name = value.trim()
    if (!name) {
      setError('파일 이름을 입력해주세요.')
      return
    }
    // 그대로면 요청 없이 닫는다.
    if (name === file.name) {
      onClose()
      return
    }
    setSubmitting(true)
    try {
      await onSubmit(file.id, name)
      onClose()
    } catch (e) {
      // 409 는 서버 문구에 내부 표기("(name: …)")가 붙어 있어 사용자 문구로 바꾼다.
      setError(
        axios.isAxiosError(e) && e.response?.status === 409
          ? '같은 폴더에 같은 이름의 파일이 있습니다.'
          : extractApiError(e, '파일 이름을 변경하지 못했습니다.'),
      )
      setSubmitting(false)
    }
  }

  return (
    <DialogContent
      onOpenAutoFocus={(e) => {
        // 기본 자동 포커스(첫 요소) 대신 입력칸에 포커스한다 — 선택 범위는 onFocus 가 건다.
        e.preventDefault()
        inputRef.current?.focus()
      }}
    >
      <DialogHeader>
        <DialogTitle>파일 이름 변경</DialogTitle>
        <DialogDescription className="sr-only">파일의 새 이름을 입력하세요</DialogDescription>
      </DialogHeader>
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          if (error) setError('')
        }}
        onFocus={(e) => {
          // 고치기 전이면 포커스를 받을 때마다 확장자 앞까지만 선택한다. 포커스 트랩이 포커스를 되찾으며 select()(전체 선택)를
          // 같은 태스크에서 부르므로(⋯ 메뉴가 닫히며 포커스를 잠깐 가져가는 경우) 다음 프레임에 건다.
          const el = e.currentTarget
          if (el.value !== file.name) return
          requestAnimationFrame(() => el.setSelectionRange(0, fileStemLength(el.value)))
        }}
        onCompositionEnd={enterKey.onCompositionEnd}
        onKeyDown={(e) => enterKey.handleEnter(e, () => void submit())}
        maxLength={255}
        aria-label="파일 이름"
        aria-invalid={error ? 'true' : undefined}
        data-testid="file-rename-input"
      />
      {error && (
        <p className="text-sm text-destructive" role="alert" data-testid="file-rename-error">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onClose} data-testid="file-rename-cancel">
          취소
        </Button>
        <Button onClick={() => void submit()} disabled={submitting} data-testid="file-rename-confirm">
          이름 변경
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
