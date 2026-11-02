// 노트 HTML 블록 대화상자(WP-1300) — 「다시 올리기」(파일·붙여 넣은 소스로 이 블록 소스만 바꾸기)와 「크게 보기」(미리보기를 큰 창으로).
// 블록 화면(WikiHtmlEmbedView)이 띄운다. 대화상자는 body 로 포털되어 편집기 키·붙여넣기 처리에 걸리지 않는다.
import { FileUp } from 'lucide-react'
import { type DragEvent, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { NoteScriptFrame } from './wikiHtmlBlockSecurity'
import { htmlEmbedDocument } from './wikiHtmlEmbedFrame'
import { WikiHtmlFileInput } from './WikiHtmlFileInput'
import { acceptHtmlFile, readHtmlFile } from './wikiHtmlImportInsert'

/** 대화상자를 닫을 때 포커스를 편집기로 돌려준다 — 기본 동작(연 단추로 돌아감)은 편집기 안 contentEditable=false 단추라 키가 편집기로 가지 않는다. */
type CloseFocus = { onCloseAutoFocus: (e: Event) => void }

/**
 * 「다시 올리기」 — HTML 파일을 끌어다 놓거나 골라 소스 칸에 불러오고(또는 소스를 직접 붙여 넣고) 「바꾸기」로 이 블록 소스만 바꾼다.
 * 파일은 바로 바꾸지 않고 칸에 먼저 채운다 — 무엇으로 바뀌는지 보고 누르게. 5MB 넘는 파일은 지금 가져오기와 같은 안내로 거른다.
 * 블록 화면이 열려 있을 때만 그린다 — 닫으면 내려가 칸·불러온 파일이 비워지고, 닫은 뒤 늦게 끝난 파일 읽기는 내려간 이 대화상자에만 닿는다.
 * 손대기 전(파일·입력 없음)에는 「바꾸기」를 막는다 — 실수로 눌러 블록을 비우지 않게. 비운 칸을 일부러 바꾸면 빈 블록이 된다.
 */
export function WikiHtmlEmbedReuploadDialog({
  open,
  onOpenChange,
  onReplace,
  closeFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onReplace: (source: string) => void
  closeFocus: CloseFocus
}) {
  const [text, setText] = useState('')
  const [touched, setTouched] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  /** 파일을 글자로 읽어 칸에 채운다 — 크기 검사는 고르기(WikiHtmlFileInput)·끌어다 놓기 모두 읽기 전에 한다. */
  const loadFile = async (file: File) => {
    const source = await readHtmlFile(file)
    if (source == null) return
    setText(source)
    setTouched(true)
    setFileName(file.name)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file && acceptHtmlFile(file)) void loadFile(file)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="wiki-html-embed-reupload-dialog" {...closeFocus}>
        <DialogHeader>
          <DialogTitle>HTML 다시 올리기</DialogTitle>
          <DialogDescription>이 블록의 소스만 바꿉니다. 이전 소스는 판 기록에서 되돌릴 수 있습니다.</DialogDescription>
        </DialogHeader>
        <div
          data-testid="wiki-html-embed-dropzone"
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            'flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-5 text-center text-sm text-muted-foreground',
            dragOver && 'border-primary bg-accent text-accent-foreground',
          )}
        >
          <FileUp className="size-5" aria-hidden />
          <p>{fileName ? `불러온 파일: ${fileName}` : 'HTML 파일을 여기에 끌어다 놓으세요 (5MB 이하)'}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            파일 고르기
          </Button>
          <WikiHtmlFileInput inputRef={inputRef} testId="wiki-html-embed-reupload-file" onFile={(f) => void loadFile(f)} />
        </div>
        <Textarea
          aria-label="새 HTML 소스"
          data-testid="wiki-html-embed-reupload-text"
          placeholder="또는 HTML 소스를 붙여 넣으세요"
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setTouched(true)
          }}
          className="h-56 resize-y font-mono text-xs leading-5"
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            type="button"
            disabled={!touched}
            data-testid="wiki-html-embed-reupload-apply"
            onClick={() => {
              onReplace(text)
              onOpenChange(false)
            }}
          >
            바꾸기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 「크게 보기」 — 블록 미리보기를 큰 창(화면 폭 95%·최대 1200px, 높이 80vh)으로 띄운다. 보기 전용이다.
 * 블록과 같은 격리 iframe(스크립트 허용·allow-same-origin 없음)이라 차트가 그대로 돈다. 높이는 창에 맞춰 고정하고 안에서 스크롤한다.
 */
export function WikiHtmlEmbedExpandDialog({
  open,
  onOpenChange,
  source,
  closeFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: string
  closeFocus: CloseFocus
}) {
  const doc = useMemo(() => htmlEmbedDocument(source), [source])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[95vw] max-w-[min(1200px,95vw)] gap-3 p-4 sm:max-w-[min(1200px,95vw)]"
        data-testid="wiki-html-embed-expand-dialog"
        {...closeFocus}
      >
        <DialogHeader>
          <DialogTitle>HTML 블록 크게 보기</DialogTitle>
          <DialogDescription className="sr-only">블록 미리보기를 큰 창으로 봅니다. 여기서는 고칠 수 없습니다.</DialogDescription>
        </DialogHeader>
        {/* 블록과 같이 노트 스위치를 따른다(WP-1290) — 멈춘 블록을 크게 보기로 돌리지 않게. */}
        <NoteScriptFrame
          register={false}
          html={doc}
          scriptSource={source}
          title="HTML 블록 크게 보기"
          data-testid="wiki-html-embed-expand-frame"
          className="block h-[80vh] w-full rounded-md border"
        />
      </DialogContent>
    </Dialog>
  )
}
