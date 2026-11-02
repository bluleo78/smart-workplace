import { useState } from 'react'

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
import { Textarea } from '@/components/ui/textarea'

import { htmlDocumentTitle } from './wikiHtmlDocument'

/**
 * 「소스 붙여 넣기」 대화상자(WP-1307) — HTML 소스를 붙여 넣어 「HTML 문서」 페이지를 만든다.
 * 제목은 비워 두면 소스의 <title> 을 쓴다(그것도 없으면 빈 제목 = 「제목 없음」). 소스가 비면 만들 수 없다(빈 문서는 메뉴의 「빈 문서」).
 * onCreate 가 true 를 돌려주면(만들고 이동함) 닫는다 — 실패(413 등)면 입력을 남긴 채 열어 둔다.
 */
export function WikiHtmlPasteDialog({
  open,
  onOpenChange,
  onCreate,
  pending,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (doc: { title: string; html: string }) => Promise<boolean>
  pending: boolean
}) {
  const [title, setTitle] = useState('')
  const [html, setHtml] = useState('')
  // 열 때마다 비운다 — 지난번 입력이 남지 않게(렌더 중 갱신 패턴).
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setTitle('')
      setHtml('')
    }
  }
  const canCreate = html.trim().length > 0 && !pending
  const submit = async () => {
    if (!canCreate) return
    const ok = await onCreate({ title: title.trim() || htmlDocumentTitle(html) || '', html })
    if (ok) onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-testid="wiki-html-paste-dialog">
        <DialogHeader>
          <DialogTitle>HTML 소스 붙여 넣기</DialogTitle>
          <DialogDescription>붙여 넣은 HTML 을 바꾸지 않고 그대로 보관해 보여 줍니다. 5MB 까지 넣을 수 있습니다.</DialogDescription>
        </DialogHeader>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목(비우면 소스의 <title>)"
          aria-label="제목"
          maxLength={255}
          data-testid="wiki-html-paste-title"
        />
        <Textarea
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          placeholder="<!doctype html>…"
          aria-label="HTML 소스"
          spellCheck={false}
          className="h-72 resize-y font-mono text-xs"
          data-testid="wiki-html-paste-source"
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={!canCreate} data-testid="wiki-html-paste-create">
            만들기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
