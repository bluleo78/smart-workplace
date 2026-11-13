// 공유 링크 화면 공용 도우미 — ?folder= 해석(WP-1538). 폴더 보기와 로그인 복귀 주소가 같은 판정을 쓴다.
import { describe, expect, it } from 'vitest'

import { parseFolderParam } from './shareSupport'

describe('parseFolderParam', () => {
  it('양의 정수만 폴더 id 로 받는다', () => {
    expect(parseFolderParam('42')).toBe(42)
  })
  it('없음·문자·음수·0·소수·안전 정수 밖은 null(공유 폴더)', () => {
    for (const raw of [null, '', 'abc', '-1', '0', '1.5', '9007199254740993']) {
      expect(parseFolderParam(raw)).toBeNull()
    }
  })
})
