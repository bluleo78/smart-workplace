// AI 답 표식 렌더러들이 함께 읽는 값 — 누르면 할 일(actions)과 이 답의 첫 출처 절 id(그림을 찾을 장을 정한다).
import { createContext } from 'react'

import type { AiDialogTargetId } from '@/lib/aiDialogTargets'

/**
 * 답 표식을 눌렀을 때 하는 일 — 구현은 화면 쪽(useHelpAnswerActions, 별도 작업)이 주고, 렌더러는 이 인터페이스만 안다.
 * 렌더러가 패널·등록부·DOM 을 직접 만지지 않게 해서 테스트에서 mock 으로 갈아 끼운다.
 */
export interface HelpAnswerActions {
  /** 출처 링크 — 도움말 패널을 그 절로 연다. */
  openHelpSection(id: string): void
  /** 굵은 화면 문구 — 같은 이름의 화면 단추로 포커스·스크롤한다. */
  focusScreenControl(text: string): void
  /** 창 열기 단추 — 열었으면 opened, 기준 단추로 스크롤만 했으면 scrolled, 지금 화면에서 열 수 없으면 missing. */
  openDialog(id: AiDialogTargetId): 'opened' | 'scrolled' | 'missing'
}

/** 렌더러 공용 값. actions 는 호출자가 주고 sourceId 는 MarkdownMessage 가 본문에서 찾아 채운다. */
export interface HelpAnswerContextValue {
  actions: HelpAnswerActions
  /** 이 답의 첫 help: 출처 절 id(없으면 null) — 그림은 이 절이 든 장 파일에서만 찾는다. */
  sourceId: string | null
}

export const HelpAnswerContext = createContext<HelpAnswerContextValue | null>(null)
