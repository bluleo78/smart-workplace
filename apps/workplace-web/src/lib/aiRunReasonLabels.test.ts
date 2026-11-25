import { describe, expect, it } from 'vitest'

import { aiRunKindLabel } from './aiRunKindLabels'
import { aiRunReasonLabel } from './aiRunReasonLabels'

describe('aiRunReasonLabel', () => {
  it.each([
    ['provider_limit', '사용 한도 초과'],
    ['provider_auth', '계정 인증 실패'],
    ['provider_rate', '요청 속도 제한'],
    ['provider_overloaded', '모델 서버 과부하'],
    ['provider_error', '모델 서버 오류'],
    ['runner_unavailable', '실행기 사용 불가'],
    ['model_not_found', '모델 없음'],
    ['timeout', '시간 초과'],
    ['model_output_invalid', '출력 형식 오류'],
    ['agent_timeout', 'AI 서버 응답 시간 초과'],
    ['agent_unreachable', 'AI 서버 연결 실패'],
    ['client_closed', '요청 취소'],
    ['runner_error', '실행 오류'],
    ['stream_error', '스트림 오류'],
    ['handler_error', '처리 오류'],
    ['failed', '실패'],
    ['http_502', 'AI 서버 오류(502)'],
    ['weird_x', 'weird_x'],
  ])('%s -> %s', (code, label) => {
    expect(aiRunReasonLabel(code)).toBe(label)
  })

  it('비어 있으면 실패', () => {
    expect(aiRunReasonLabel(null)).toBe('실패')
    expect(aiRunReasonLabel(undefined)).toBe('실패')
    expect(aiRunReasonLabel('')).toBe('실패')
  })
})

describe('aiRunKindLabel 이벤트 종류', () => {
  it.each([
    ['ISSUE_AGENT_RUN', '이슈 AI 실행'],
    ['RECURRING_RUN', '반복 작업 실행'],
    ['RECURRING_TEST_RUN', '반복 작업 테스트 실행'],
    ['ISSUE_CHAT_REPLY', '이슈 챗 AI 답'],
    ['MESSAGING_REPLY', '채팅 AI 답'],
  ])('%s -> %s', (code, label) => {
    expect(aiRunKindLabel(code)).toBe(label)
  })
})
