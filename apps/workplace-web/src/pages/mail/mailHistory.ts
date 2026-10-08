// 메일 화면 히스토리 키 설정(WP-280) — 상수만 두어 vitest 로 계획(planOpen/planClose)을 고정한다.
import type { HistoryParamOptions } from '@/lib/historyParam'

/**
 * 열린 메일 = ?messageId. 메일을 바꾸거나 콜드로 닫을 때 첨부 뷰어 키(?preview=mail:{id})도 함께 지운다.
 * 왜: 앞 메일 첨부 키가 남으면 다른 메일에서 "이 메일에 없는 첨부" 안내가 뜬다.
 */
export const MAIL_DETAIL_PARAM: HistoryParamOptions = { clear: ['preview'] }
