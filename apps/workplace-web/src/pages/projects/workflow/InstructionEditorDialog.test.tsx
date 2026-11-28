// InstructionEditorDialog(WP-2092) — 블록 단위 서식 편집·원문 모드·목차·공통 지시 보기·적용/취소.
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { expectToggleLook } from '@/test/kits/projects/listBoard'

import { replaceBlock, splitInstructionBlocks } from './instructionBlocks'
import { InstructionEditorDialog, type SharedInstruction } from './InstructionEditorDialog'

// AI 패널 상태를 테스트가 바꿀 수 있게 — null 이면 패널 없음(modal), { mode: 'side' } 면 옆 패널이 열린 것(non-modal)
const assistant = vi.hoisted(() => ({ value: null as null | { mode: 'side'; close: () => void } }))
vi.mock('@/components/ai/AIAssistantContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ai/AIAssistantContext')>()),
  useOptionalAssistant: () => assistant.value,
}))

// 원문 모드 목차가 낡은 파싱을 쓰는 상황을 만들려고 useDeferredValue 를 얼릴 수 있게 한다(null 이면 평소대로)
const deferredFreeze = vi.hoisted(() => ({ value: null as string | null }))
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useDeferredValue: <T,>(v: T): T => (deferredFreeze.value !== null ? (deferredFreeze.value as unknown as T) : v),
}))

const TEXT = '## 목표\n\n본문 문단\n\n| 항목 | 내용 |\n| --- | --- |\n| a | b |\n'

function setup(over: Partial<{ text: string; shared: SharedInstruction[]; readOnly: boolean }> = {}) {
  const onApply = vi.fn()
  const onOpenChange = vi.fn()
  // 열린 사이 부모가 text 를 바꾸는 경우(AI·YAML 탭)를 흉내 낼 수 있게 현재 text 를 들고 있는다
  let currentText = over.text ?? TEXT
  let currentReadOnly = over.readOnly ?? false
  // 다시 그릴 때마다 새 요소로 — 같은 요소를 넘기면 React 가 다시 그리지 않아 AI 패널 상태를 다시 읽지 않는다
  const ui = () => (
    <InstructionEditorDialog
      open
      onOpenChange={onOpenChange}
      nodeName="분석"
      nodeKey="analyze"
      text={currentText}
      shared={over.shared ?? []}
      readOnly={currentReadOnly}
      onApply={onApply}
    />
  )
  const { rerender } = render(ui())
  return {
    onApply,
    onOpenChange,
    user: userEvent.setup(),
    rerender: (nextText?: string, nextReadOnly?: boolean) => {
      if (nextText !== undefined) currentText = nextText
      if (nextReadOnly !== undefined) currentReadOnly = nextReadOnly
      rerender(ui())
    },
  }
}

describe('InstructionEditorDialog', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => {
    assistant.value = null
    deferredFreeze.value = null
    vi.restoreAllMocks()
  })

  it('열면_블록이_렌더되고_표가_table로_보인다', () => {
    setup()
    expect(screen.getAllByTestId('instruction-block')).toHaveLength(splitInstructionBlocks(TEXT).blocks.length)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('✦ 분석 — 지시 편집')).toBeInTheDocument()
    expect(screen.getByText(`analyze · ${TEXT.length}자`)).toBeInTheDocument()
  })

  it('블록_하나만_고치고_적용하면_그_블록만_바뀐다', async () => {
    const { onApply, user } = setup()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    const ta = screen.getByLabelText('블록 원문')
    expect(ta).toHaveValue('본문 문단')
    await user.type(ta, '!')
    await user.click(screen.getByRole('button', { name: '적용' }))
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith(replaceBlock(TEXT, 1, '본문 문단!'))
  })

  it('편집중_빈줄을_넣어도_포커스가_유지된다', async () => {
    const { onApply, user } = setup()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    const ta = screen.getByLabelText('블록 원문')
    await user.type(ta, '{Enter}{Enter}둘째')
    expect(screen.getByLabelText('블록 원문')).toBe(ta)
    expect(document.activeElement).toBe(ta)
    await user.click(screen.getByRole('button', { name: '적용' }))
    expect(onApply).toHaveBeenCalledWith('## 목표\n\n본문 문단\n\n둘째\n\n| 항목 | 내용 |\n| --- | --- |\n| a | b |\n')
  })

  it('입력칸에서_Esc는_편집만_끝낸다', async () => {
    const { onOpenChange, user } = setup()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    await user.keyboard('{Escape}')
    expect(screen.queryByLabelText('블록 원문')).toBeNull()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('한글_조합_중_Esc는_편집을_끝내지_않는다', async () => {
    const { user } = setup()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    fireEvent.keyDown(screen.getByLabelText('블록 원문'), { key: 'Escape', isComposing: true })
    expect(screen.getByLabelText('블록 원문')).toBeInTheDocument()
  })

  it('새_블록에서_Esc_뒤_포커스는_마지막_블록이나_블록추가_버튼', async () => {
    const { user } = setup()
    // 비운 채 Esc — 블록 추가 버튼으로
    await user.click(screen.getByRole('button', { name: '+ 블록 추가' }))
    await user.keyboard('{Escape}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '+ 블록 추가' }))
    // 글을 쓰고 Esc — 새로 생긴 마지막 블록으로
    await user.click(screen.getByRole('button', { name: '+ 블록 추가' }))
    await user.type(screen.getByLabelText('블록 원문'), '새 글')
    await user.keyboard('{Escape}')
    const blocks = screen.getAllByTestId('instruction-block')
    expect(blocks[blocks.length - 1]).toHaveTextContent('새 글')
    expect(document.activeElement).toBe(blocks[blocks.length - 1])
  })

  it('블록_입력칸의_Ctrl_B_와_Ctrl_I_는_서식을_넣는다', async () => {
    const { user } = setup()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    const ta = screen.getByLabelText('블록 원문') as HTMLTextAreaElement
    ta.setSelectionRange(0, 2)
    fireEvent.keyDown(ta, { key: 'b', code: 'KeyB', ctrlKey: true })
    expect(screen.getByLabelText('블록 원문')).toHaveValue('**본문** 문단')
    ta.setSelectionRange(7, 9)
    // 한글 자판이면 key 가 ㅑ 로 온다 — code 로 판정
    fireEvent.keyDown(ta, { key: 'ㅑ', code: 'KeyI', metaKey: true })
    expect(screen.getByLabelText('블록 원문')).toHaveValue('**본문** *문단*')
  })

  it('편집중_다른_블록을_누르면_그_블록으로_옮겨_글이_보존된다', async () => {
    const { onApply, user } = setup()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    await user.type(screen.getByLabelText('블록 원문'), '\n\n끼움')
    // 편집 칸이 된 블록 1 은 testid 목록에서 빠져 표(블록 2)가 두 번째 항목이다
    await user.click(screen.getAllByTestId('instruction-block')[1])
    expect(screen.getByLabelText('블록 원문')).toHaveValue('| 항목 | 내용 |\n| --- | --- |\n| a | b |')
    // 렌더된 블록 — 표는 편집 칸이 되어 표로 다시 그려지지 않고(중복 없음), 끼워 넣은 문단은 자기 블록으로 보인다
    expect(screen.getAllByTestId('instruction-block').map((b) => b.textContent)).toEqual(['목표', '본문 문단', '끼움'])
    expect(screen.queryByRole('table')).toBeNull()
    await user.click(screen.getByRole('button', { name: '적용' }))
    expect(onApply).toHaveBeenCalledWith('## 목표\n\n본문 문단\n\n끼움\n\n| 항목 | 내용 |\n| --- | --- |\n| a | b |\n')
  })

  it('빈_새_블록이_열린_채_다른_블록을_누르면_되돌리고_그_블록을_연다', async () => {
    const { onApply, user } = setup()
    await user.click(screen.getByRole('button', { name: '+ 블록 추가' }))
    await user.click(screen.getAllByTestId('instruction-block')[1])
    expect(screen.getByLabelText('블록 원문')).toHaveValue('본문 문단')
    await user.type(screen.getByLabelText('블록 원문'), '!')
    await user.click(screen.getByRole('button', { name: '적용' }))
    expect(onApply).toHaveBeenCalledWith(replaceBlock(TEXT, 1, '본문 문단!'))
  })

  it('AI_패널을_열고_닫아도_편집이_남는다', async () => {
    const { onApply, user, rerender } = setup()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    await user.type(screen.getByLabelText('블록 원문'), '!')
    // AI 옆 패널 열기 — 대화상자가 non-modal 로 바뀌며 Radix 가 Content 를 새로 마운트한다
    assistant.value = { mode: 'side', close: () => {} }
    rerender()
    expect(screen.getByLabelText('블록 원문')).toHaveValue('본문 문단!')
    // 다시 마운트된 입력칸이 AI 입력의 포커스를 뺏지 않는다
    expect(document.activeElement).not.toBe(screen.getByLabelText('블록 원문'))
    // AI 패널 닫기 — 다시 modal
    assistant.value = null
    rerender()
    expect(screen.getByText(`analyze · ${TEXT.length + 1}자`)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '적용' }))
    expect(onApply).toHaveBeenCalledWith(replaceBlock(TEXT, 1, '본문 문단!'))
  })

  it('취소는_onApply가_없다', async () => {
    const { onApply, onOpenChange, user } = setup()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    await user.type(screen.getByLabelText('블록 원문'), '!')
    await user.click(screen.getByRole('button', { name: '취소' }))
    expect(onApply).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('바꾸지_않고_적용하면_onApply가_없다', async () => {
    const { onApply, onOpenChange, user } = setup()
    await user.click(screen.getByRole('button', { name: '적용' }))
    expect(onApply).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('전부_지우고_적용하면_null', async () => {
    const { onApply, user } = setup()
    await user.click(screen.getByRole('button', { name: '마크다운 원문' }))
    await user.clear(screen.getByLabelText('지시 원문'))
    await user.click(screen.getByRole('button', { name: '적용' }))
    expect(onApply).toHaveBeenCalledWith(null)
  })

  it('빈_지시는_안내_블록과_블록추가로_쓸_수_있다', async () => {
    const { onApply, user } = setup({ text: '' })
    await user.click(screen.getByText('여기를 눌러 지시를 쓰세요'))
    await user.type(screen.getByLabelText('블록 원문'), '첫 글')
    await user.click(screen.getByRole('button', { name: '적용' }))
    expect(onApply).toHaveBeenCalledWith('첫 글')
  })

  it('블록_추가는_끝에_새_블록을_붙이고_비우면_되돌린다', async () => {
    const { onApply, user } = setup()
    await user.click(screen.getByRole('button', { name: '+ 블록 추가' }))
    await user.type(screen.getByLabelText('블록 원문'), '새 글')
    await user.click(screen.getByRole('button', { name: '적용' }))
    expect(onApply).toHaveBeenCalledWith(TEXT + '\n새 글')
  })

  it('새_블록을_쓰다_앞_블록을_누르면_그_블록_구간이_열린다', async () => {
    const { onApply, user } = setup()
    await user.click(screen.getByRole('button', { name: '+ 블록 추가' }))
    await user.type(screen.getByLabelText('블록 원문'), '새 글')
    await user.click(screen.getAllByTestId('instruction-block')[0])
    expect(screen.getByLabelText('블록 원문')).toHaveValue('## 목표')
    await user.type(screen.getByLabelText('블록 원문'), '!')
    await user.click(screen.getByRole('button', { name: '적용' }))
    expect(onApply).toHaveBeenCalledWith(replaceBlock(TEXT, 0, '## 목표!') + '\n새 글')
  })

  it('블록_추가_뒤_비워두면_원문_그대로', async () => {
    const { onApply, onOpenChange, user } = setup()
    await user.click(screen.getByRole('button', { name: '+ 블록 추가' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: '적용' }))
    expect(onApply).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('열린_사이_text가_바뀌어도_고치지_않고_적용하면_onApply가_없다', async () => {
    const { onApply, onOpenChange, user, rerender } = setup()
    // 창이 열린 사이 AI·YAML 탭이 지시를 바꿨다 — 사용자는 아무것도 고치지 않았으니 옛 글로 덮으면 안 된다
    rerender('다른 곳에서 바뀐 지시')
    await user.click(screen.getByRole('button', { name: '적용' }))
    expect(onApply).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('연_뒤_text가_바뀌고_고친_글이_있으면_적용이_알림만_보이고_onApply가_없다', async () => {
    const { onApply, onOpenChange, user, rerender } = setup()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    await user.type(screen.getByLabelText('블록 원문'), '!')
    rerender('다른 곳에서 바뀐 지시')
    await user.click(screen.getByRole('button', { name: '적용' }))
    expect(screen.getByRole('alert')).toHaveTextContent('창을 연 뒤 다른 곳에서 이 지시가 바뀌었어요.')
    expect(onApply).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '그래도 적용' }))
    expect(onApply).toHaveBeenCalledWith(replaceBlock(TEXT, 1, '본문 문단!'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('새_글_불러오기는_초안을_새_text로_바꾸고_뒤이은_적용은_onApply가_없다', async () => {
    const { onApply, onOpenChange, user, rerender } = setup()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    await user.type(screen.getByLabelText('블록 원문'), '!')
    rerender('다른 곳에서 바뀐 지시')
    await user.click(screen.getByRole('button', { name: '적용' }))
    await user.click(screen.getByRole('button', { name: '새 글 불러오기' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('다른 곳에서 바뀐 지시')).toBeInTheDocument()
    expect(screen.queryByLabelText('블록 원문')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '적용' }))
    expect(onApply).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('연_뒤_text가_바뀌었어도_초안이_현재_text와_같으면_알림_없이_닫는다', async () => {
    const { onApply, onOpenChange, user, rerender } = setup()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    await user.type(screen.getByLabelText('블록 원문'), '!')
    rerender(replaceBlock(TEXT, 1, '본문 문단!'))
    await user.click(screen.getByRole('button', { name: '적용' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('편집_방식_단추는_켜진_쪽만_토글_켜짐으로_보인다', async () => {
    // WP-2165: 켜짐은 secondary 가 아니라 디자인 시스템 토글 켜짐(TOGGLE_ON)으로 표시한다.
    const { user } = setup()
    const format = screen.getByRole('button', { name: '서식 편집' })
    const raw = screen.getByRole('button', { name: '마크다운 원문' })
    expect(format).toHaveAttribute('aria-pressed', 'true')
    expectToggleLook(format, true)
    expectToggleLook(raw, false)
    await user.click(raw)
    expectToggleLook(raw, true)
    expectToggleLook(format, false)
  })

  it('공통_지시를_보다가_서식_편집을_누르면_지시_보기로_돌아온다', async () => {
    const { user } = setup({ shared: [{ name: 'rules', text: '규칙 글' }] })
    await user.click(screen.getByRole('button', { name: /rules/ }))
    expect(screen.getByText('공통 지시 rules — 읽기 전용')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '서식 편집' }))
    expect(screen.queryByText('공통 지시 rules — 읽기 전용')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('instruction-block').length).toBeGreaterThan(0)
  })

  it('원문_모드_목차가_낡은_파싱이어도_현재_초안의_블록으로_스크롤한다', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: '마크다운 원문' }))
    // 목차는 아직 옛 글 기준(목표 = 0번)인데 초안 앞에 문단이 하나 생겼다 — 현재 파싱에선 목표가 1번
    deferredFreeze.value = TEXT
    fireEvent.change(screen.getByLabelText('지시 원문'), { target: { value: '앞 문단\n\n' + TEXT } })
    await user.click(within(screen.getByRole('navigation', { name: '목차' })).getByRole('button', { name: '목표' }))
    const target = vi.mocked(Element.prototype.scrollIntoView).mock.contexts[0] as HTMLElement
    expect(target.getAttribute('data-block-index')).toBe('1')
  })

  it('블록_추가만_눌러도_글자수가_늘지_않는다', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: '+ 블록 추가' }))
    expect(screen.getByLabelText('블록 원문')).toBeInTheDocument()
    expect(screen.getByText(`analyze · ${TEXT.length}자`)).toBeInTheDocument()
  })

  it('원문_모드에서_위에_제목이_생겨_목차가_낡아도_누른_제목의_블록으로_스크롤한다', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: '마크다운 원문' }))
    deferredFreeze.value = TEXT
    // 앞에 다른 제목이 생겼다 — 낡은 목차는 목표 하나뿐이라 순번만 쓰면 새 제목(0번)으로 간다
    fireEvent.change(screen.getByLabelText('지시 원문'), { target: { value: '## 새 제목\n\n' + TEXT } })
    await user.click(within(screen.getByRole('navigation', { name: '목차' })).getByRole('button', { name: '목표' }))
    const target = vi.mocked(Element.prototype.scrollIntoView).mock.contexts[0] as HTMLElement
    expect(target.getAttribute('data-block-index')).toBe('1')
  })

  it('알림이_뜬_뒤_text가_원래대로_돌아오면_알림이_사라진다', async () => {
    const { user, rerender } = setup()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    await user.type(screen.getByLabelText('블록 원문'), '!')
    rerender('B')
    await user.click(screen.getByRole('button', { name: '적용' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    rerender(TEXT)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('알림이_뜬_뒤_text가_또_바뀌면_알림이_남고_최신_글을_보기_전엔_그래도_적용이_적용하지_않는다', async () => {
    const { onApply, user, rerender } = setup()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    await user.type(screen.getByLabelText('블록 원문'), '!')
    rerender('B')
    await user.click(screen.getByRole('button', { name: '적용' }))
    rerender('C')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '그래도 적용' }))
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '그래도 적용' }))
    expect(onApply).toHaveBeenCalledTimes(1)
  })

  it('알림이_뜬_뒤_읽기_전용이_되면_알림과_그래도_적용이_없다', async () => {
    const { user, rerender } = setup()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    await user.type(screen.getByLabelText('블록 원문'), '!')
    rerender('B')
    await user.click(screen.getByRole('button', { name: '적용' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    rerender(undefined, true)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '그래도 적용' })).not.toBeInTheDocument()
  })

  it('AI_패널이_열려_non_modal_일_때_바깥을_눌러도_창이_닫히지_않는다', async () => {
    assistant.value = { mode: 'side', close: () => {} }
    const { onOpenChange } = setup()
    // Radix 는 바깥 pointerdown 리스너를 한 틱 뒤에 단다
    await new Promise((r) => setTimeout(r, 10))
    fireEvent.pointerDown(document.body)
    fireEvent.focusIn(document.body)
    await new Promise((r) => setTimeout(r, 10))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('instruction-editor-dialog')).toBeInTheDocument()
  })

  it('새_블록에_공백과_줄바꿈만_쓰고_나가면_원문_그대로', async () => {
    const { onApply, user } = setup()
    await user.click(screen.getByRole('button', { name: '+ 블록 추가' }))
    await user.type(screen.getByLabelText('블록 원문'), '  {Enter}')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: '적용' }))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('공백만_쓴_새_블록이_열린_채_다른_블록을_누르면_되돌리고_그_블록을_연다', async () => {
    const { onApply, user } = setup()
    await user.click(screen.getByRole('button', { name: '+ 블록 추가' }))
    await user.type(screen.getByLabelText('블록 원문'), ' ')
    await user.click(screen.getAllByTestId('instruction-block')[0])
    expect(screen.getByLabelText('블록 원문')).toHaveValue('## 목표')
    await user.click(screen.getByRole('button', { name: '적용' }))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('목차를_누르면_그_블록으로_스크롤한다', async () => {
    const { user } = setup()
    await user.click(within(screen.getByRole('navigation', { name: '목차' })).getByRole('button', { name: '목표' }))
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
    // 그 제목 블록(0번) 요소에서 불렸다
    const target = vi.mocked(Element.prototype.scrollIntoView).mock.contexts[0] as HTMLElement
    expect(target.getAttribute('data-block-index')).toBe('0')
  })

  it('제목이_없으면_안내가_보인다', () => {
    setup({ text: '그냥 문단' })
    expect(screen.getByText('제목(##)이 없어요')).toBeInTheDocument()
  })

  it('공통_지시를_누르면_읽기전용으로_보인다', async () => {
    const { user } = setup({ shared: [{ name: 'rules', text: '규칙 글' }, { name: 'gone', text: null }] })
    expect(screen.getByRole('button', { name: /gone/ })).toBeDisabled()
    expect(screen.getByText('정의 없음')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /rules/ }))
    expect(screen.getByText('공통 지시 rules — 읽기 전용')).toBeInTheDocument()
    expect(screen.getByText('규칙 글')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '지시로 돌아가기' }))
    expect(screen.getAllByTestId('instruction-block').length).toBeGreaterThan(0)
  })

  it('도구줄은_편집중일때만_켜진다', async () => {
    const { user } = setup()
    expect(screen.getByRole('button', { name: '굵게' })).toBeDisabled()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    const bold = screen.getByRole('button', { name: '굵게' })
    expect(bold).toBeEnabled()
    const ta = screen.getByLabelText('블록 원문') as HTMLTextAreaElement
    ta.setSelectionRange(0, 2)
    await user.click(bold)
    expect((screen.getByLabelText('블록 원문') as HTMLTextAreaElement).value).toContain('**')
  })

  it('readOnly면_적용이_없다', async () => {
    const { user } = setup({ readOnly: true })
    expect(screen.queryByRole('button', { name: '적용' })).toBeNull()
    expect(screen.getByRole('button', { name: '닫기' })).toBeInTheDocument()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    expect(screen.queryByLabelText('블록 원문')).toBeNull()
  })

  // 리뷰 후속(WP-2092) — 블록을 고치던 중 읽기 전용이 되면 편집을 끝낸다(남은 입력칸에 친 글이 버려지지 않게)
  it('블록_편집_중_읽기_전용이_되면_편집이_끝나고_고친_글은_남는다', async () => {
    const { user, rerender } = setup()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    await user.type(screen.getByLabelText('블록 원문'), '!')
    rerender(undefined, true)
    expect(screen.queryByLabelText('블록 원문')).toBeNull()
    expect(screen.getByText('본문 문단!')).toBeInTheDocument()
  })

  // 리뷰 후속(WP-2092) — text 가 원래대로 돌아오면 알림 기억(warnedText)도 비워, 다음 바깥 변경에 알림이 저절로 다시 뜨지 않게
  it('알림이_뜬_뒤_text가_원래대로_돌아왔다가_또_바뀌어도_알림이_저절로_뜨지_않는다', async () => {
    const { user, rerender } = setup()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    await user.type(screen.getByLabelText('블록 원문'), '!')
    rerender('B')
    await user.click(screen.getByRole('button', { name: '적용' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    rerender(TEXT)
    rerender('C')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // 리뷰 후속(WP-2092) — 원문 모드 입력칸의 Esc 는 블록 편집처럼 입력칸만 떠난다(창은 닫지 않는다)
  it('원문_모드_입력칸에서_Esc는_입력칸만_떠나고_창은_닫지_않는다', async () => {
    const { onOpenChange, user } = setup()
    await user.click(screen.getByRole('button', { name: '마크다운 원문' }))
    await user.click(screen.getByLabelText('지시 원문'))
    await user.keyboard('{Escape}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '마크다운 원문' }))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  // 리뷰 후속(WP-2092) — 고친 글이 있으면 두 번째 Esc 로 창이 확인 없이 닫히지 않는다(바깥 클릭과 같은 막기)
  it('고친_글이_있으면_편집을_끝낸_뒤_Esc로_창이_닫히지_않는다', async () => {
    const { onOpenChange, user } = setup()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    await user.type(screen.getByLabelText('블록 원문'), '!')
    await user.keyboard('{Escape}')
    await user.keyboard('{Escape}')
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('원문_모드에서_고친_글이_있으면_Esc_두_번에도_창이_닫히지_않는다', async () => {
    const { onOpenChange, user } = setup()
    await user.click(screen.getByRole('button', { name: '마크다운 원문' }))
    await user.type(screen.getByLabelText('지시 원문'), '!')
    await user.keyboard('{Escape}')
    await user.keyboard('{Escape}')
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('고친_글이_없으면_편집을_끝낸_뒤_Esc로_창이_닫힌다', async () => {
    const { onOpenChange, user } = setup()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    await user.keyboard('{Escape}')
    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  // 리뷰 후속(WP-2092) — 읽기 전용인데 지시가 비면 빈 가운데 대신 안내를 보인다
  it('읽기_전용에서_지시가_비면_지시가_없습니다_안내가_보인다', () => {
    setup({ text: '', readOnly: true })
    expect(screen.getByText('지시가 없습니다')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '여기를 눌러 지시를 쓰세요' })).toBeNull()
  })

  // 리뷰 후속(WP-2092) — notice(노드가 사라짐 등)를 주면 안내가 보이고, 고치던 글은 원문 모드에서 복사할 수 있게 남는다
  it('notice를_주면_안내가_보인다', () => {
    render(
      <InstructionEditorDialog open onOpenChange={() => {}} nodeName="분석" nodeKey="analyze" text={TEXT} shared={[]} readOnly notice="이 노드가 사라져 적용할 수 없어요" onApply={() => {}} />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('이 노드가 사라져 적용할 수 없어요')
  })

  // 리뷰 후속 2(WP-2092) — Esc 닫기 막기는 적용과 같은 규칙: 고친 글이 지금 text 와 같으면(다른 곳이 같은 글로 바꿈) 잃을 게 없으니 닫는다
  it('고친_글이_바뀐_text와_같으면_Esc로_창이_닫힌다', async () => {
    const { onOpenChange, user, rerender } = setup()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    await user.type(screen.getByLabelText('블록 원문'), '!')
    rerender(TEXT.replace('본문 문단', '본문 문단!'))
    await user.keyboard('{Escape}')
    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  // 리뷰 후속 2(WP-2092) — 블록을 고치던 중 읽기 전용이 되면 포커스는 그 블록으로 돌아간다(body 로 빠지지 않게)
  it('블록_편집_중_읽기_전용이_되면_포커스가_그_블록으로_돌아간다', async () => {
    const { user, rerender } = setup()
    await user.click(screen.getAllByTestId('instruction-block')[1])
    rerender(undefined, true)
    expect(document.activeElement).toBe(screen.getAllByTestId('instruction-block')[1])
  })
})
