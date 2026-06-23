// 프로젝트 시각 식별자 — 백엔드에 색상 필드가 없어 key 해시로 결정적 색을 생성한다.
// 같은 key 는 항상 같은 색(hue). 사이드바 프로젝트 항목의 컬러 사각형에 사용.

/** key 문자열 → 결정적 HSL 배경/전경색. */
export function projectColor(key: string): { bg: string; fg: string } {
  let h = 0
  for (let i = 0; i < key.length; i++) {
    // 32bit unsigned 해시 — 같은 입력은 항상 같은 출력.
    h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0
  }
  const hue = h % 360
  // 채도/명도 고정 — 다크/라이트 모두에서 흰 텍스트가 읽히도록 명도 45%.
  return { bg: `hsl(${hue} 60% 45%)`, fg: 'hsl(0 0% 100%)' }
}

/** key 앞 1–2자 대문자 — 컬러 사각형 안에 표시. */
export function projectInitial(key: string): string {
  return key.slice(0, 2).toUpperCase()
}

/** 이름 문자열 → 결정적 HSL 색(멤버 아바타 배경). */
export function nameColor(name: string): { bg: string; fg: string } {
  let h = 0
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0
  }
  return { bg: `hsl(${h % 360} 60% 45%)`, fg: 'hsl(0 0% 100%)' }
}

/** 이름 첫 글자(대문자) — 아바타 안에 표시. */
export function nameInitial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase()
}
