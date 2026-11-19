import { render, screen, within } from '@testing-library/react'
import { FolderX } from 'lucide-react'
import { expect, test, vi } from 'vitest'

import { ResourceErrorState } from './ResourceErrorState'

test('titleAs 생략 시 제목은 기존처럼 문단으로 렌더된다', () => {
  render(
    <ResourceErrorState
      icon={FolderX}
      title="리소스를 불러올 수 없습니다"
      description="요청한 리소스를 찾을 수 없습니다."
      actionLabel="돌아가기"
      onAction={vi.fn()}
    />,
  )

  expect(screen.getByText('리소스를 불러올 수 없습니다').tagName).toBe('P')
  expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  // 문단 제목이어도 안내는 alert 로 읽힌다 (WP-1773)
  expect(screen.getByRole('alert')).toHaveTextContent('리소스를 불러올 수 없습니다')
})

test('안내 제목·설명은 화면 읽기가 바로 읽도록 alert 하나로 묶이고 버튼은 밖에 둔다 (WP-1773)', () => {
  render(
    <ResourceErrorState
      icon={FolderX}
      title="프로젝트를 불러올 수 없습니다"
      titleAs="h1"
      description="요청한 프로젝트가 존재하지 않거나 접근 권한이 없습니다."
      actionLabel="프로젝트 목록으로"
      onAction={vi.fn()}
    />,
  )
  // getByRole 은 alert 가 둘 이상이면 실패한다 — 「alert 하나」를 함께 지킨다
  const alert = screen.getByRole('alert')
  expect(within(alert).getByRole('heading', { level: 1, name: '프로젝트를 불러올 수 없습니다' })).toBeInTheDocument()
  expect(alert).toHaveTextContent('요청한 프로젝트가 존재하지 않거나 접근 권한이 없습니다.')
  expect(within(alert).queryByRole('button')).not.toBeInTheDocument()
})
