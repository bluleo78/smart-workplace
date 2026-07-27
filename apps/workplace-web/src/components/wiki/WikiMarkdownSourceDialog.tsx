// 노트 본문의 마크다운 원문을 읽기 전용으로 보여주는 모달(#753).
// 에디터에 의존하지 않는 표시 전용 컴포넌트 — 호출부가 스냅샷 문자열을 내려준다.
// 실시간 구독을 하지 않는 이유는 WikiEditor 의 onViewSource 주석 참조.
import { Copy, Download } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { downloadBlob } from '@/lib/download'

import { wikiMarkdownFilename } from './wikiMarkdownFilename'

interface WikiMarkdownSourceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 다운로드 파일명 생성에 쓰인다. */
  title: string
  /** 표시할 마크다운 원문 (호출부가 모달을 열 때 스냅샷으로 만든다). */
  markdown: string
}

/** 마크다운 소스 보기 — 복사·.md 다운로드 제공. 편집 기능은 없다. */
export function WikiMarkdownSourceDialog({
  open,
  onOpenChange,
  title,
  markdown,
}: WikiMarkdownSourceDialogProps) {
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown)
      toast.success('마크다운을 복사했습니다')
    } catch {
      // 클립보드 권한 거부·비보안 컨텍스트 등. 사용자가 직접 선택 복사할 수 있으므로 안내만 한다.
      toast.error('복사에 실패했습니다. 직접 선택해 복사해 주세요')
    }
  }

  const onDownload = () => {
    downloadBlob(
      wikiMarkdownFilename(title),
      new Blob([markdown], { type: 'text/markdown;charset=utf-8;' }),
    )
    // downloadBlob 은 실질적으로 던지지 않는다 — onCopy 와 달리 try/catch 는 불필요하고
    // 성공 피드백만 맞춰준다.
    toast.success('마크다운 파일을 내려받았습니다')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* sm: 접두 필수 — 프리미티브 기본 클래스가 sm:max-w-lg 라 브레이크포인트 없는 max-w-3xl 은
          tailwind-merge 가 서로 다른 키로 보고 둘 다 남겨서 미디어쿼리가 붙은 쪽이 이긴다. */}
      <DialogContent className="sm:max-w-3xl" data-testid="wiki-source-dialog">
        <DialogHeader>
          <DialogTitle>마크다운 소스</DialogTitle>
          <DialogDescription>
            저장되는 원문입니다. 읽기 전용이며 여기서 편집할 수 없습니다.
          </DialogDescription>
        </DialogHeader>
        {/* 긴 표 행이 모달 밖으로 밀리지 않도록 가로 스크롤을 컨테이너 안에 가둔다.
            tabIndex 로 포커스 가능하게 해 키보드만 쓰는 사용자도 스크롤할 수 있게 한다
            (WCAG 2.1.1) — aria-label 은 스크린리더가 이 영역이 무엇인지 알 수 있게 한다. */}
        <pre
          data-testid="wiki-source-pre"
          tabIndex={0}
          aria-label="마크다운 소스"
          className="max-h-[60vh] overflow-auto rounded-md border bg-muted p-4 font-mono text-xs leading-5 text-foreground"
        >
          {markdown}
        </pre>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCopy} data-testid="wiki-source-copy">
            <Copy aria-hidden="true" /> 복사
          </Button>
          <Button onClick={onDownload} data-testid="wiki-source-download">
            <Download aria-hidden="true" /> .md 다운로드
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
