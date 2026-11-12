// 리포트 러너 공유 조각(WP-1486) — 프로젝트 리포트·개인 보고가 함께 쓰는 한 줄 정리·이슈 한 줄·출력 정리를 고정한다.
import { describe, it, expect } from 'vitest'
import { cleanOutput, formatIssue, sanitizeInline, type ReportIssueInput } from './report-shared.js'

const issue: ReportIssueInput = {
  key: 'WP-1',
  url: 'https://w.example/projects/WP/issues/1',
  title: '로그인 <b>고치기</b>',
  statusName: '진행 중',
  category: 'IN_PROGRESS',
  assignees: ['김철수'],
  epic: null,
  dueDate: '2026-11-10',
  lastComment: null,
  reason: 'OVERDUE',
}

describe('sanitizeInline', () => {
  it('꺾쇠를 전각으로 바꾸고 공백을 한 칸으로 접는다', () => {
    expect(sanitizeInline('  a <x>\n\n b  ')).toBe('a ＜x＞ b')
  })

  it('null·undefined 는 빈 글', () => {
    expect(sanitizeInline(null)).toBe('')
    expect(sanitizeInline(undefined)).toBe('')
  })
})

describe('formatIssue', () => {
  it('키·url 로 시작하고 선정 이유를 말로 싣는다', () => {
    const line = formatIssue(issue)
    expect(line.startsWith('- WP-1 https://')).toBe(true)
    expect(line).toContain('이유: 기한 지남')
    expect(line).toContain('제목: <issue>로그인 ＜b＞고치기＜/b＞</issue>')
  })
})

describe('cleanOutput', () => {
  it('전체를 감싼 코드 펜스를 벗긴다', () => {
    expect(cleanOutput('```md\nA\n```', 'personal_report', 20000)).toBe('A')
  })

  it('빈 글은 {code}_empty', () => {
    expect(() => cleanOutput('  \n ', 'personal_report', 20000)).toThrow('personal_report_empty')
  })

  it('상한(코드 포인트)을 넘으면 {code}_too_long', () => {
    expect(() => cleanOutput('가'.repeat(20001), 'personal_report', 20000)).toThrow('personal_report_too_long')
    expect(cleanOutput('가'.repeat(20000), 'personal_report', 20000)).toHaveLength(20000)
  })

  it('프로젝트 코드는 project_report_ 접두로 던진다', () => {
    expect(() => cleanOutput('', 'project_report', 20000)).toThrow('project_report_empty')
  })
})
