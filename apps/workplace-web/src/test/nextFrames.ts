// 테스트 공용 — 몇 프레임(100ms) 기다린다. 닫힘 뒤 초점이 「옮겨지지 않음」을 볼 때, 늦게 도는 복귀가 있었다면 끝났을 만큼 기다린 뒤 단언한다(WP-1804).
import { act } from '@testing-library/react'

export const nextFrames = () => act(() => new Promise<void>((r) => setTimeout(r, 100)))
