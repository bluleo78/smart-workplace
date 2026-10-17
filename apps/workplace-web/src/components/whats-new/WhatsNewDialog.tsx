// 「새 소식」 창 — 실행 중인 웹 버전의 릴리스 노트와 접힌 이전 소식, 하단 버전·커밋을 보여준다(WP-439).
// 노트는 빌드에 번들돼 있어(useWhatsNew 가 모듈 로드 시 고른다) 테넌트·네트워크와 무관하게 같은 내용을 보여준다.
import { ChevronDown } from 'lucide-react'
import { useRef } from 'react'

import { MarkdownMessage } from '@/components/ai/MarkdownMessage'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

import { currentNote as current, previousNotes as previous } from './useWhatsNew'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * 닫힘 포커스 복원 재정의 — 열 때 포커스를 갖던 요소가 이미 사라진 경우(모바일: 계정 시트의 줄이 시트와 함께 닫힘)에
   * 호출자가 되돌릴 곳을 직접 정한다. preventDefault() 하면 공용 복원(useDialogFocusRestore)은 건너뛴다.
   */
  onCloseAutoFocus?: (event: Event) => void
}

export function WhatsNewDialog({ open, onOpenChange, onCloseAutoFocus }: Props) {
  const empty = !current && previous.length === 0
  const contentRef = useRef<HTMLDivElement>(null)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        data-testid="whats-new-dialog"
        className="max-h-[85dvh] grid-rows-[auto_minmax(0,1fr)_auto]"
        // 열릴 때 포커스를 창 자체에 둔다 — 기본 동작은 첫 포커스 대상(이전 소식 토글)에 주는데, 메뉴에서 열면 그 토글에
        // 키보드 포커스 링이 처음부터 떠 있게 된다. 키보드 사용자는 Tab 으로 토글에 닿는다.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          contentRef.current?.focus()
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle className="flex items-baseline gap-2 pr-6">
            새 소식
            {current?.date && <span className="text-xs font-normal text-muted-foreground">{current.date}</span>}
          </DialogTitle>
          <DialogDescription className="sr-only">이 버전에서 달라진 점</DialogDescription>
        </DialogHeader>
        {/* 본문이 길면 창 안에서만 스크롤한다(제목·버전 줄은 고정). */}
        <div className="min-h-0 space-y-4 overflow-y-auto">
          {empty && <p className="text-sm text-muted-foreground">새 소식이 없습니다</p>}
          {current && <MarkdownMessage>{current.body}</MarkdownMessage>}
          {previous.length > 0 && (
            <section className="space-y-1 border-t pt-3">
              <h3 className="text-xs font-semibold text-muted-foreground">이전 소식</h3>
              {previous.map((note) => (
                <Collapsible key={note.version} className="group">
                  <CollapsibleTrigger
                    data-testid={`whats-new-previous-${note.version}`}
                    // 마우스 클릭 뒤엔 포커스 링을 남기지 않고 키보드 포커스에서만 보인다(focus-visible) — shadcn 트리거와 같은 방식.
                    className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-medium outline-none transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <span>v{note.version}</span>
                    {note.date && <span className="text-xs font-normal text-muted-foreground">{note.date}</span>}
                    <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mb-2 ml-2 mt-2 border-l pl-3">
                    <MarkdownMessage>{note.body}</MarkdownMessage>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </section>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          버전 {__APP_VERSION_LABEL__}
          {__GIT_SHA_SHORT__ && ` (${__GIT_SHA_SHORT__})`}
        </p>
      </DialogContent>
    </Dialog>
  )
}
