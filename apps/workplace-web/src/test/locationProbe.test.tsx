// location() 이 새 화면과 같은 시점의 주소를 돌려주는지(WP-1061, renderPage·renderScreen 공통 trackLocation) — 새 화면의 효과 안에서도
// 새 주소여야 한다. 예전 LocationProbe(패시브 효과·화면 뒤)는 여기서 '/start' 를 돌려줬다 — CI 부하의 findBy* 직후 지연을 결정적으로 재현한다.
import { screen } from '@testing-library/react'
import { useEffect, useLayoutEffect } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { expect, test } from 'vitest'

import { renderScreen } from './renderScreen'

test('새 화면이 그려진 직후(그 화면의 효과 안)에도 location() 은 새 주소다', async () => {
  const seen: string[] = []
  let location = () => ''
  /** 이동한 화면 — 자기 레이아웃 효과와 패시브 효과에서 그 순간의 location() 을 적는다. */
  function Next() {
    useLayoutEffect(() => {
      seen.push(`layout ${location()}`)
    }, [])
    useEffect(() => {
      seen.push(`passive ${location()}`)
    }, [])
    return <div data-testid="next-landed">다음</div>
  }
  const screenView = renderScreen(
    <Routes>
      <Route path="/start" element={<Link to="/next?tab=a">가기</Link>} />
      <Route path="/next" element={<Next />} />
    </Routes>,
    { path: '/start' },
  )
  location = screenView.location
  await screenView.user.click(screen.getByRole('link', { name: '가기' }))
  expect(await screen.findByTestId('next-landed')).toBeInTheDocument()
  expect(seen).toEqual(['layout /next?tab=a', 'passive /next?tab=a'])
  expect(location()).toBe('/next?tab=a')
})
