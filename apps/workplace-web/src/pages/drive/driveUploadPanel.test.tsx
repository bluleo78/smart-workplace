// 드라이브 업로드 패널(WP-1531) — 화면 컴포넌트 테스트.
// 패널만 renderScreen 으로 띄우고 배치(batch)를 props 로 넣어 상태별 문구·testid·접힘/펼침·단추 콜백을 본다.
// 실제 순차 업로드·취소·다시 시도 배선은 drivePage.test.tsx 가, 화면 위치(오른쪽 아래·모바일 탭바 위)는 E2E(@layout)가 본다.
import { screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'

import { renderScreen } from '@/test/renderScreen'

import { DriveUploadPanel } from './DriveUploadPanel'
import { summarize, type UploadBatch, type UploadItem } from './uploadQueue'
import { makeFile } from './uploadTestUtils'

/** 테스트 배치 — 항목·상태만 주면 id·자리(root)를 채운다. */
type BatchInput = Omit<UploadBatch, 'id' | 'root'>
function toBatch(input: BatchInput): UploadBatch {
  return { id: 1, root: { sid: 1, folderId: null }, ...input }
}

/** 배치 항목 하나를 만든다 — id 는 이름으로 둬 콜백 인자를 읽기 쉽게 한다. */
function item(name: string, status: UploadItem['status'], extra: Partial<UploadItem> = {}): UploadItem {
  return { id: name, file: makeFile(name, extra.file?.size ?? 10), path: [], status, percent: status === 'done' ? 100 : null, ...extra }
}

/** 패널을 그린다. 콜백은 vi.fn 으로 돌려준다. */
function renderPanel(input: BatchInput, { isMobile = false, mobileLift }: { isMobile?: boolean; mobileLift?: string } = {}) {
  const batch = toBatch(input)
  const onCancel = vi.fn()
  const onRetry = vi.fn()
  const onClose = vi.fn()
  const view = renderScreen(
    <DriveUploadPanel batch={batch} summary={summarize(batch)} isMobile={isMobile} mobileLift={mobileLift} onCancel={onCancel} onRetry={onRetry} onClose={onClose} />,
  )
  return { ...view, onCancel, onRetry, onClose }
}

const MB = 1024 * 1024

/** 목업 ① — 폴더 「디자인」 5개 중 2개 완료, 1개 올리는 중(42%), 2개 대기. */
function runningBatch(): BatchInput {
  return {
    items: [
      item('로고.svg', 'done', { path: ['디자인'] }),
      item('시안_v3.fig', 'done', { path: ['디자인'] }),
      { ...item('화면 녹화.mov', 'uploading', { path: ['디자인', '녹화'], percent: 42 }), file: makeFile('화면 녹화.mov', 412 * MB) },
      item('a.png', 'queued'),
      item('b.png', 'queued'),
    ],
    cancelled: false,
    running: true,
  }
}

describe('올리는 중', () => {
  test('펼침 — 머리 「업로드 2/5」·「모두 취소」, 완료·올리는 중 행, 대기는 「대기 2개」 한 줄', async () => {
    const { user, onCancel } = renderPanel(runningBatch())
    const panel = screen.getByTestId('drive-upload-panel')
    expect(within(panel).getByText('업로드 2/5')).toBeInTheDocument()
    const rows = within(panel).getAllByTestId('drive-upload-row')
    expect(rows.map((r) => r.dataset.status)).toEqual(['done', 'done', 'uploading'])
    expect(within(rows[0]).getByText('로고.svg')).toBeInTheDocument()
    expect(within(rows[0]).getByText('완료')).toBeInTheDocument()
    expect(within(rows[0]).getByText('디자인')).toBeInTheDocument()
    // 올리는 중 행 — 하위 경로·「{pct}% · {파일 크기}」·진행 막대
    expect(within(rows[2]).getByText('디자인 / 녹화')).toBeInTheDocument()
    expect(within(rows[2]).getByText('42% · 412.0 MB')).toBeInTheDocument()
    expect(within(rows[2]).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42')
    expect(within(panel).getByText('대기 2개')).toBeInTheDocument()
    // 올리는 동안엔 닫기(✕)가 없다 — 닫으면 진행 중 배치를 볼 곳이 사라진다.
    expect(within(panel).queryByTestId('drive-upload-panel-close')).not.toBeInTheDocument()
    expect(within(panel).queryByTestId('drive-upload-panel-bar')).not.toBeInTheDocument()
    const cancel = within(panel).getByTestId('drive-upload-panel-cancel')
    expect(cancel).toHaveTextContent('모두 취소')
    await user.click(cancel)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  test('머리 단추를 누르면 접혀 한 줄(전체 막대·「취소」)이 되고, 다시 누르면 펼쳐진다', async () => {
    const { user, onCancel } = renderPanel(runningBatch())
    const toggle = screen.getByTestId('drive-upload-panel-toggle')
    // 접기 단추는 「모두 취소」 뒤 별도 단추 — 이름은 접기/펼치기, 상태는 aria-expanded
    expect(screen.getByRole('button', { name: '업로드 목록 접기', expanded: true })).toBe(toggle)
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAccessibleName('업로드 목록 펼치기')
    const panel = screen.getByTestId('drive-upload-panel')
    expect(within(panel).getByText('업로드 2/5')).toBeInTheDocument()
    expect(within(panel).queryAllByTestId('drive-upload-row')).toHaveLength(0)
    // 전체 진행률 = (완료 2 + 0.42) / 5 → 48%
    expect(within(panel).getByTestId('drive-upload-panel-bar')).toHaveAttribute('aria-valuenow', '48')
    expect(within(panel).getByTestId('drive-upload-panel-cancel')).toHaveTextContent(/^취소$/)
    await user.click(within(panel).getByTestId('drive-upload-panel-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    await user.click(toggle)
    expect(within(panel).getAllByTestId('drive-upload-row')).toHaveLength(3)
  })

  test('모바일은 접힌 채로 시작한다', () => {
    renderPanel(runningBatch(), { isMobile: true })
    expect(screen.getByTestId('drive-upload-panel-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('drive-upload-panel-bar')).toBeInTheDocument()
    expect(screen.queryAllByTestId('drive-upload-row')).toHaveLength(0)
  })

  // 모바일 위치 — 탭바(없으면 0)와 하단 안전 영역 중 큰 값 위 8px. 선택 막대가 떠 있으면 그 높이(mobileLift)만큼 더 올린다.
  // 실제 겹침(픽셀)은 jsdom 이 재지 못해 E2E(@layout)가 보고, 여기선 bottom 식에 각 항이 들어가는지만 본다.
  test('모바일은 탭바·안전 영역 위에 뜨고, 선택 막대 높이만큼 더 올라간다', () => {
    const { unmount } = renderPanel(runningBatch(), { isMobile: true })
    const plain = screen.getByTestId('drive-upload-panel').style.bottom
    expect(plain).toContain('var(--mobile-tabbar-h, 0px)')
    expect(plain).toContain('env(safe-area-inset-bottom, 0px)')
    expect(plain).not.toContain('3.5rem')
    unmount()
    renderPanel(runningBatch(), { isMobile: true, mobileLift: '3.5rem' })
    expect(screen.getByTestId('drive-upload-panel').style.bottom).toContain('3.5rem')
  })

  test('완료가 5개를 넘으면 최근 5개만 행으로, 나머지는 「완료 {n}개」로 묶는다', () => {
    const done = Array.from({ length: 7 }, (_, i) => item(`f${i}.txt`, 'done'))
    renderPanel({ items: [...done, item('g.txt', 'uploading', { percent: 10 })], cancelled: false, running: true })
    const rows = screen.getAllByTestId('drive-upload-row')
    expect(rows.filter((r) => r.dataset.status === 'done').map((r) => r.textContent)).toEqual(
      ['f2.txt', 'f3.txt', 'f4.txt', 'f5.txt', 'f6.txt'].map((n) => `${n}완료`),
    )
    expect(screen.getByText('완료 2개')).toBeInTheDocument()
  })
})

describe('끝남', () => {
  test('모두 성공 — 「{n}개 업로드 완료」와 닫기만 있고, 닫기를 누르면 onClose', async () => {
    const { user, onClose } = renderPanel({ items: [item('a.txt', 'done'), item('b.txt', 'done')], cancelled: false, running: false })
    const panel = screen.getByTestId('drive-upload-panel')
    expect(within(panel).getByText('2개 업로드 완료')).toBeInTheDocument()
    expect(within(panel).queryByTestId('drive-upload-panel-cancel')).not.toBeInTheDocument()
    expect(within(panel).queryAllByTestId('drive-upload-row')).toHaveLength(0)
    await user.click(within(panel).getByTestId('drive-upload-panel-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('실패 있음 — 머리 「{ok}개 완료 · {fail}개 실패」, 실패 행에 이유와 「다시 시도」, 완료는 한 줄', async () => {
    const { user, onRetry } = renderPanel({
      items: [
        item('a.txt', 'done'),
        item('b.txt', 'done'),
        item('broken.txt', 'failed', { path: ['문서'], error: '저장 공간이 부족합니다', retryable: true }),
      ],
      cancelled: false,
      running: false,
    })
    const panel = screen.getByTestId('drive-upload-panel')
    expect(within(panel).getByText('2개 완료 · 1개 실패')).toBeInTheDocument()
    const rows = within(panel).getAllByTestId('drive-upload-row')
    expect(rows.map((r) => r.dataset.status)).toEqual(['failed'])
    expect(within(rows[0]).getByText('문서')).toBeInTheDocument()
    expect(within(rows[0]).getByText('저장 공간이 부족합니다')).toHaveClass('text-destructive')
    expect(within(panel).getByText('완료 2개')).toBeInTheDocument()
    expect(within(panel).getByTestId('drive-upload-panel-close')).toBeInTheDocument()
    expect(within(panel).queryByTestId('drive-upload-panel-cancel')).not.toBeInTheDocument()
    // 다시 시도 단추마다 어느 파일인지 접근성 이름에 담는다(보이는 글자는 「다시 시도」 그대로)
    const retry = within(rows[0]).getByRole('button', { name: 'broken.txt 다시 시도' })
    expect(retry).toHaveTextContent(/^다시 시도$/)
    await user.click(retry)
    expect(onRetry).toHaveBeenCalledWith('broken.txt')
    // 실패가 있으면 접고 펼 수 있다
    await user.click(screen.getByTestId('drive-upload-panel-toggle'))
    expect(within(panel).queryAllByTestId('drive-upload-row')).toHaveLength(0)
  })

  test('크기 초과 실패 행엔 「다시 시도」가 없다', () => {
    renderPanel({
      items: [item('원본 촬영.mov', 'failed', { error: '동영상 1GB 초과', retryable: false })],
      cancelled: false,
      running: false,
    })
    const row = screen.getByTestId('drive-upload-row')
    expect(within(row).getByText('동영상 1GB 초과')).toBeInTheDocument()
    expect(within(row).queryByTestId('drive-upload-retry')).not.toBeInTheDocument()
  })

  test('취소함 — 「업로드를 취소했어요 · {done}개 완료 · {fail}개 실패」, 닫기 있음, 「다시 시도」 없음', async () => {
    const { user, onClose } = renderPanel({
      items: [
        item('a.txt', 'done'),
        item('b.txt', 'failed', { error: '업로드 실패', retryable: true }),
        item('c.txt', 'cancelled'),
        item('d.txt', 'cancelled'),
      ],
      cancelled: true,
      running: false,
    })
    const panel = screen.getByTestId('drive-upload-panel')
    expect(within(panel).getByText('업로드를 취소했어요 · 1개 완료 · 1개 실패')).toBeInTheDocument()
    expect(within(panel).queryByTestId('drive-upload-retry')).not.toBeInTheDocument()
    expect(within(panel).queryByTestId('drive-upload-panel-cancel')).not.toBeInTheDocument()
    await user.click(within(panel).getByTestId('drive-upload-panel-close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('취소함·실패 없음 — 머리에 실패 수를 붙이지 않는다', () => {
    renderPanel({ items: [item('a.txt', 'cancelled')], cancelled: true, running: false })
    expect(screen.getByText('업로드를 취소했어요 · 0개 완료')).toBeInTheDocument()
  })
})

describe('데스크톱 위치 (WP-1534)', () => {
  test('데스크톱 패널은 오른쪽 칸(--right-dock-width) 옆에 뜬다', () => {
    renderPanel(runningBatch())
    expect(screen.getByTestId('drive-upload-panel').style.right).toBe('calc(var(--right-dock-width, 0px) + 1rem)')
  })
})
