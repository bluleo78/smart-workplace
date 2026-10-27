// 공용 브레드크럼 확장(WP-979) — 주소 대신 동작으로 옮겨 다니는 화면(onSelect)과 앱이 항목을 직접 그리는 훅(renderItem).
// 링크·현재 항목·접기의 기본 동작은 연락처 페이지 테스트(contactsBreadcrumb)가 지킨다.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import { renderWithProviders } from '@/test/renderWithProviders'

import { Breadcrumb, type BreadcrumbItem } from './Breadcrumb'

test('onSelect 가 있는 조상은 링크가 아닌 버튼이고, 누르면 그 동작을 부른다', async () => {
  const onRoot = vi.fn()
  const items: BreadcrumbItem[] = [
    { key: 'root', label: '디자인 공간', onSelect: onRoot, to: '/ignored', testId: 'crumb-root' },
    { key: 'cur', label: '2026', testId: 'crumb-cur' },
  ]
  renderWithProviders(<Breadcrumb items={items} />)
  const root = screen.getByTestId('crumb-root')
  expect(root.tagName).toBe('BUTTON')
  await userEvent.click(root)
  expect(onRoot).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('crumb-cur')).toHaveAttribute('aria-current', 'page')
})

test('접힌 「…」 메뉴에서도 onSelect 를 부른다', async () => {
  const onMid = vi.fn()
  const items: BreadcrumbItem[] = [
    { key: 1, label: '공간', onSelect: vi.fn() },
    { key: 2, label: '문서', onSelect: onMid },
    { key: 3, label: '2026', onSelect: vi.fn() },
    { key: 4, label: '디자인', onSelect: vi.fn() },
    { key: 5, label: '시안' },
  ]
  renderWithProviders(<Breadcrumb items={items} />)
  await userEvent.click(screen.getByTestId('breadcrumb-more'))
  await userEvent.click(await screen.findByRole('menuitem', { name: '문서' }))
  expect(onMid).toHaveBeenCalledTimes(1)
})

test('renderItem 이 돌려준 요소로 조상·현재를 그리고, null 이면 기본 모양으로 그린다', () => {
  const items: BreadcrumbItem[] = [
    { key: 'root', label: '공간', to: '/a' },
    { key: 'mid', label: '문서', to: '/b', testId: 'crumb-mid' },
    { key: 'cur', label: '2026' },
  ]
  renderWithProviders(
    <Breadcrumb
      items={items}
      renderItem={(item, { current, className }) =>
        item.key === 'mid' ? null : (
          <span data-testid={`custom-${item.key}`} data-current={String(current)} className={className}>
            {item.label}
          </span>
        )
      }
    />,
  )
  expect(screen.getByTestId('custom-root')).toHaveAttribute('data-current', 'false')
  expect(screen.getByTestId('custom-cur')).toHaveAttribute('data-current', 'true')
  // null → 기본 링크.
  expect(screen.getByTestId('crumb-mid').tagName).toBe('A')
})

test('trailing 은 경로 뒤, 같은 nav 안에 그린다', () => {
  renderWithProviders(
    <Breadcrumb items={[{ key: 'a', label: '공간', to: '/a' }, { key: 'b', label: '기획' }]} trailing={<span data-testid="badge">AI</span>} />,
  )
  const nav = screen.getByTestId('breadcrumb')
  expect(nav).toContainElement(screen.getByTestId('badge'))
  // 보이는 경로 줄(첫 ol) 다음 형제다.
  expect(nav.querySelector('ol')!.nextElementSibling).toContainElement(screen.getByTestId('badge'))
})
