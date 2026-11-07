import { render, screen } from '@testing-library/react'
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
})
