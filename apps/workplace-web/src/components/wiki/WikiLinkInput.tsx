import { type FormEvent, useRef, useState } from 'react'

import { MobileSheetShell } from '@/components/mobile/MobileSheetShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

import type { WikiLinkUi } from './useWikiLinkUi'

const INVALID_MESSAGE = '올바른 링크 주소를 입력하세요'

/**
 * 주소 입력 폼 — 입력칸 + 넣기. Enter 로 적용, 넣을 수 없는 주소면 아래에 오류를 보이고 열어 둔다.
 * onApply 가 false 를 돌려주면 잘못된 주소다(정규화·위험 주소 판정은 normalizeLinkInput).
 */
function LinkForm({
  initialHref,
  submitLabel,
  onApply,
  touch,
}: {
  initialHref: string
  /** 새로 넣기면 '넣기', 기존 링크 고치기면 '고치기'. */
  submitLabel: string
  onApply: (raw: string) => boolean
  touch: boolean
}) {
  const [value, setValue] = useState(initialHref)
  const [invalid, setInvalid] = useState(false)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setInvalid(!onApply(value))
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5" noValidate>
      <div className="flex items-center gap-2">
        <Input
          // 모바일 키보드에 / · .com 이 보이는 주소 자판. type=url 의 브라우저 검증은 noValidate 로 끄고 직접 판정한다.
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setInvalid(false)
          }}
          placeholder="https://"
          aria-label="링크 주소"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? 'wiki-link-input-error' : undefined}
          data-testid="wiki-link-input"
          // 터치는 44px·16px(포커스 시 iOS 확대 방지), 데스크톱은 툴바 밀도에 맞춘 h-8.
          className={cn(touch ? 'h-11 text-base' : 'h-8')}
        />
        <Button type="submit" size={touch ? 'lg' : 'sm'} className={cn(touch && 'h-11')} data-testid="wiki-link-apply">
          {submitLabel}
        </Button>
      </div>
      {invalid && (
        <p id="wiki-link-input-error" role="alert" data-testid="wiki-link-input-error" className="text-sm text-destructive">
          {INVALID_MESSAGE}
        </p>
      )}
    </form>
  )
}

/**
 * 링크 주소 입력(WP-312) — 데스크톱은 고칠 범위 위에 붙는 작은 팝오버, 터치 셸은 키보드 위로 올라오는 바텀시트.
 * 팝오버는 BubbleMenu 밖에 둔다: BubbleMenu 는 선택·문서가 바뀔 때만 다시 판정해서 "입력 중" 같은 화면 상태로는 열고 닫을 수 없다.
 * 입력칸이 포커스를 가져가면 에디터가 blur 되어 AI·링크 버블이 저절로 숨는다(AI 툴바는 input 이 열린 동안 shouldShow 로도 막는다).
 */
export function WikiLinkInput({ ui, touch }: { ui: WikiLinkUi; touch: boolean }) {
  // Esc 로 닫을 때만 에디터로 포커스를 돌린다(적용은 applyInput 이 돌린다) — 바깥 클릭으로 닫힐 땐 그 클릭이 커서를 정한다.
  const refocusRef = useRef(false)
  const target = ui.input
  if (!target) return null
  const editing = target.initialHref !== ''
  const title = editing ? '링크 고치기' : '링크 넣기'
  const form = (
    <LinkForm
      key={target.seq}
      initialHref={target.initialHref}
      submitLabel={editing ? '고치기' : '넣기'}
      onApply={ui.applyInput}
      touch={touch}
    />
  )

  if (touch) {
    return (
      <MobileSheetShell
        open
        onClose={() => ui.closeInput(false)}
        title={title}
        description="링크 주소를 입력하세요"
        testId="wiki-link-input-sheet"
        autoFocus
      >
        <div className="px-4 pb-4 pt-1">{form}</div>
      </MobileSheetShell>
    )
  }

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) ui.closeInput(refocusRef.current)
        refocusRef.current = false
      }}
    >
      {/* 가상 앵커 — 고칠 범위의 화면 좌표. */}
      <PopoverAnchor virtualRef={{ current: { getBoundingClientRect: ui.inputRect } }} />
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={16}
        // 가상 앵커라 스크롤 조상을 몰라 매 프레임 다시 잰다(범위 풀기는 상태별로 기억해 싸다).
        updatePositionStrategy="always"
        data-testid="wiki-link-input-popover"
        aria-label={title}
        onEscapeKeyDown={() => {
          refocusRef.current = true
        }}
        // 닫힐 때 포커스 복원은 closeInput 이 맡는다(트리거가 없어 Radix 가 엉뚱한 곳으로 돌리지 않게).
        onCloseAutoFocus={(e) => e.preventDefault()}
        // 표면은 에디터 플로팅 툴바(EditorFloatingToolbar)와 같은 rounded-lg·촘촘한 안쪽 여백으로 맞춘다.
        className="w-80 max-w-[calc(100vw-2rem)] rounded-lg p-2"
      >
        {form}
      </PopoverContent>
    </Popover>
  )
}
