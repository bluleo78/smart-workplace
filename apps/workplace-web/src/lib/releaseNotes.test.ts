import { afterEach, describe, expect, it } from 'vitest'

import {
  compareSemver,
  isUnread,
  markSeen,
  parseReleaseNote,
  type ReleaseNote,
  selectWhatsNew,
  WHATS_NEW_STORAGE_KEY,
} from './releaseNotes'

/** 테스트용 노트 팩토리 — 필요한 필드만 덮어쓴다. */
const n = (version: string, over: Partial<ReleaseNote> = {}): ReleaseNote => ({
  version,
  date: '2026-10-20',
  body: `${version} 본문`,
  hidden: false,
  ...over,
})

describe('parseReleaseNote', () => {
  it('semver 가 아닌 파일명(README 등)은 무시한다', () => {
    expect(parseReleaseNote('README.md', '# x')).toBeNull()
  })

  it('frontmatter 의 version·date 와 본문을 읽는다', () => {
    expect(
      parseReleaseNote('0.9.0.md', '---\nversion: 0.9.0\ndate: 2026-10-20\n---\n## 드라이브\n- 미리보기'),
    ).toEqual({ version: '0.9.0', date: '2026-10-20', hidden: false, body: '## 드라이브\n- 미리보기' })
  })

  it('hidden: true 면 숨김 노트다', () => {
    const note = parseReleaseNote('0.9.0.md', '---\nversion: 0.9.0\ndate: 2026-10-20\nhidden: true\n---\n본문')
    expect(note?.hidden).toBe(true)
  })

  it('hidden 은 문자열 true 만 참이다', () => {
    const note = parseReleaseNote('0.9.0.md', '---\nhidden: false\n---\n본문')
    expect(note?.hidden).toBe(false)
  })

  it('frontmatter 의 version 이 없으면 파일명을 쓴다', () => {
    expect(parseReleaseNote('1.2.3.md', '---\ndate: 2026-10-20\n---\n본문')?.version).toBe('1.2.3')
  })

  it('frontmatter 의 version 이 파일명과 달라도 파일명 버전을 쓴다', () => {
    expect(parseReleaseNote('0.9.0.md', '---\nversion: v0.9.0\n---\n본문')?.version).toBe('0.9.0')
    expect(parseReleaseNote('0.9.0.md', '---\nversion: 9.9.9\n---\n본문')?.version).toBe('0.9.0')
  })

  it('값을 감싼 따옴표 한 쌍은 벗긴다(hidden·date)', () => {
    const note = parseReleaseNote('0.9.0.md', '---\ndate: "2026-10-20"\nhidden: "true"\n---\n본문')
    expect(note).toMatchObject({ date: '2026-10-20', hidden: true })
    expect(parseReleaseNote('0.9.0.md', "---\ndate: '2026-10-20'\nhidden: 'true'\n---\n본문")).toMatchObject({
      date: '2026-10-20',
      hidden: true,
    })
    // 짝이 안 맞는 따옴표는 그대로 둔다.
    expect(parseReleaseNote('0.9.0.md', '---\ndate: "2026-10-20\n---\n본문')?.date).toBe('"2026-10-20')
  })

  it('CRLF 줄바꿈 frontmatter 도 파싱한다', () => {
    expect(parseReleaseNote('0.9.0.md', '---\r\ndate: 2026-10-20\r\nhidden: true\r\n---\r\n본문\r\n')).toEqual({
      version: '0.9.0',
      date: '2026-10-20',
      hidden: true,
      body: '본문',
    })
  })

  it('빈 frontmatter 블록(---\\n---)도 걷어 내고 본문만 남긴다', () => {
    expect(parseReleaseNote('0.9.0.md', '---\n---\n본문')).toEqual({
      version: '0.9.0',
      date: '',
      hidden: false,
      body: '본문',
    })
  })

  it('구분선 뒤 공백(`--- `)이 있어도 frontmatter 로 읽고, hidden: true 는 숨김으로 유지한다', () => {
    expect(parseReleaseNote('0.9.0.md', '--- \ndate: 2026-10-20\nhidden: true\n--- \n본문')).toEqual({
      version: '0.9.0',
      date: '2026-10-20',
      hidden: true,
      body: '본문',
    })
    // 빈 블록 + 공백 구분선 조합
    expect(parseReleaseNote('0.9.0.md', '---\t\n--- \n본문')?.body).toBe('본문')
  })

  it('frontmatter 가 없으면 전체가 본문이다', () => {
    expect(parseReleaseNote('1.2.3.md', '본문만')).toEqual({
      version: '1.2.3',
      date: '',
      hidden: false,
      body: '본문만',
    })
  })
})

describe('compareSemver', () => {
  it('숫자로 비교한다(0.10.0 > 0.9.0)', () => {
    expect(compareSemver('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareSemver('0.9.0', '0.10.0')).toBeLessThan(0)
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0)
  })

  it('프리릴리스는 같은 숫자 버전보다 낮다', () => {
    expect(compareSemver('1.0.0-rc.1', '1.0.0')).toBeLessThan(0)
    expect(compareSemver('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
    expect(compareSemver('1.0.0-rc.2', '1.0.0-rc.10')).toBeLessThan(0)
  })
})

describe('selectWhatsNew', () => {
  it('앱 버전과 같은 노트가 current, 낮은 노트가 previous 다', () => {
    const r = selectWhatsNew([n('0.8.0'), n('0.9.0')], '0.9.0')
    expect(r.current?.version).toBe('0.9.0')
    expect(r.previous.map((x) => x.version)).toEqual(['0.8.0'])
  })

  it('숨김 노트는 제외한다', () => {
    const r = selectWhatsNew([n('0.8.0'), n('0.9.0', { hidden: true })], '0.9.0')
    expect(r.current).toBeNull()
    expect(r.previous.map((x) => x.version)).toEqual(['0.8.0'])
  })

  it('dev 빌드는 가장 높은 노트가 current 다', () => {
    const r = selectWhatsNew([n('0.8.0'), n('0.10.0')], 'dev')
    expect(r.current?.version).toBe('0.10.0')
    expect(r.previous.map((x) => x.version)).toEqual(['0.8.0'])
  })

  it('앱 버전보다 높은 노트는 previous 에 넣지 않고 previous 는 내림차순이다', () => {
    const r = selectWhatsNew([n('0.7.0'), n('0.10.0'), n('0.8.0'), n('0.9.0')], '0.9.0')
    expect(r.previous.map((x) => x.version)).toEqual(['0.8.0', '0.7.0'])
  })

  it('노트가 없으면 비어 있다', () => {
    expect(selectWhatsNew([], '0.9.0')).toEqual({ current: null, previous: [] })
  })
})

describe('isUnread', () => {
  it('저장된 버전이 현재보다 낮으면 안 읽음이다', () => {
    expect(isUnread(n('0.9.0'), { getItem: () => '0.8.0' })).toBe(true)
    // 숫자 부분은 수치로 비교한다(0.10.0 > 0.9.0).
    expect(isUnread(n('0.10.0'), { getItem: () => '0.9.0' })).toBe(true)
  })

  it('저장된 버전이 현재보다 새것이면(롤링 업데이트·롤백) 안 읽음이 아니다', () => {
    expect(isUnread(n('0.9.0'), { getItem: () => '0.10.0' })).toBe(false)
    expect(isUnread(n('0.9.0'), { getItem: () => '1.0.0' })).toBe(false)
  })

  it('저장된 값이 semver 가 아니면(깨진 값) 없는 것으로 보고 안 읽음이다', () => {
    expect(isUnread(n('0.9.0'), { getItem: () => 'garbage' })).toBe(true)
  })

  it('저장된 버전이 같으면 읽음이다', () => {
    expect(isUnread(n('0.9.0'), { getItem: () => '0.9.0' })).toBe(false)
  })

  it('저장된 값이 없으면 안 읽음이다', () => {
    expect(isUnread(n('0.9.0'), { getItem: () => null })).toBe(true)
  })

  it('current 가 없으면 안 읽음이 아니다', () => {
    expect(isUnread(null, { getItem: () => '0.8.0' })).toBe(false)
  })

  it('저장소 접근이 throw 하면 안 읽음으로 본다', () => {
    expect(
      isUnread(n('0.9.0'), {
        getItem: () => {
          throw new Error()
        },
      }),
    ).toBe(true)
  })

  it('고정된 키로 읽는다', () => {
    const keys: string[] = []
    isUnread(n('0.9.0'), { getItem: (k) => (keys.push(k), null) })
    expect(keys).toEqual([WHATS_NEW_STORAGE_KEY])
    expect(WHATS_NEW_STORAGE_KEY).toBe('genia.whatsNew.lastSeenVersion')
  })
})

/** 인메모리 저장소 — markSeen 이 읽기(getItem)와 쓰기(setItem)를 모두 하므로 둘을 함께 가진 가짜를 쓴다. */
function memoryStorage(initial?: string) {
  const data: Record<string, string> = initial === undefined ? {} : { [WHATS_NEW_STORAGE_KEY]: initial }
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
  }
}

describe('markSeen', () => {
  it('키에 버전을 저장한다', () => {
    const storage = memoryStorage()
    markSeen('0.9.0', storage)
    expect(storage.data).toEqual({ 'genia.whatsNew.lastSeenVersion': '0.9.0' })
  })

  it('기록된 버전보다 새 버전이면 덮어쓴다', () => {
    const storage = memoryStorage('0.8.0')
    markSeen('0.9.0', storage)
    expect(storage.data[WHATS_NEW_STORAGE_KEY]).toBe('0.9.0')
  })

  it('기록된 버전이 더 새것이면 뒤로 되돌리지 않는다', () => {
    const storage = memoryStorage('0.10.0')
    markSeen('0.9.0', storage)
    expect(storage.data[WHATS_NEW_STORAGE_KEY]).toBe('0.10.0')
  })

  it('깨진 기록값은 덮어쓴다', () => {
    const storage = memoryStorage('garbage')
    markSeen('0.9.0', storage)
    expect(storage.data[WHATS_NEW_STORAGE_KEY]).toBe('0.9.0')
  })

  it('저장소가 throw 해도 삼킨다', () => {
    expect(() =>
      markSeen('0.9.0', {
        getItem: () => null,
        setItem: () => {
          throw new Error()
        },
      }),
    ).not.toThrow()
  })
})

describe('localStorage 전역 접근이 throw 하는 환경', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

  /** 전역 localStorage 접근 자체가 SecurityError 를 던지게 만든다(차단된 사이트 데이터·샌드박스 iframe 재현). */
  function blockLocalStorage() {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError')
      },
    })
  }

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it('저장소 인자 없이 isUnread 를 불러도 throw 하지 않고 안 읽음으로 본다', () => {
    blockLocalStorage()
    expect(isUnread(n('0.9.0'))).toBe(true)
  })

  it('저장소 인자 없이 markSeen 을 불러도 throw 하지 않는다', () => {
    blockLocalStorage()
    expect(() => markSeen('0.9.0')).not.toThrow()
  })
})
