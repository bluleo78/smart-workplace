import { describe, expect, it } from 'vitest'

import { projectColor, projectInitial } from './project-color'

describe('projectColor', () => {
  it('같은 key 는 항상 같은 색(결정적)', () => {
    expect(projectColor('WP')).toEqual(projectColor('WP'))
  })

  it('다른 key 는 다른 hue', () => {
    expect(projectColor('WP').bg).not.toEqual(projectColor('AI').bg)
  })
})

describe('projectInitial', () => {
  it('앞 2자 대문자', () => {
    expect(projectInitial('wp')).toBe('WP')
    expect(projectInitial('Engineering')).toBe('EN')
  })

  it('1자 key 는 1자', () => {
    expect(projectInitial('x')).toBe('X')
  })
})
