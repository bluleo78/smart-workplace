// 운영자 매뉴얼 촬영용 가상 데이터 — 시드(seed-operator.mjs)와 촬영 장면(scenes/operator.mjs)이 함께 읽는다.
// 계정 도메인은 예약 도메인 example.com 이라 실계정과 겹치지 않는다. 사람·회사 이름은 모두 가상이다.

export const DOMAIN = 'example.com';

/** 촬영 계정(플랫폼 슈퍼어드민) — 빈 DB 의 첫 가입자. 촬영 장면이 이 계정으로 로그인한다. */
export const OPERATOR = { username: `ops@${DOMAIN}`, name: '플랫폼 운영자' };

/**
 * 가상 테넌트와 구성원. status 는 시드가 끝났을 때의 상태(ACTIVE·SUSPENDED·DELETED).
 * 구성원의 첫 항목이 소유자다. 같은 사람이 두 테넌트에 있으면 두 번째부터는 「기존 사용자 추가」로 넣는다.
 */
export const TENANTS = [
  {
    name: '누리커머스',
    slug: 'nuri-commerce',
    status: 'ACTIVE',
    members: [
      { email: 'seoyeon', name: '김서연', role: 'OWNER' },
      { email: 'junho', name: '이준호', role: 'MEMBER' },
      { email: 'jimin', name: '박지민', role: 'MEMBER' },
      { email: 'yuna', name: '최유나', role: 'MEMBER' },
    ],
  },
  {
    name: '한빛물류',
    slug: 'hanbit-logistics',
    status: 'ACTIVE',
    members: [
      { email: 'haneul', name: '정하늘', role: 'OWNER' },
      { email: 'minjae', name: '오민재', role: 'MEMBER' },
    ],
  },
  {
    name: '새솔디자인',
    slug: 'saesol-design',
    status: 'SUSPENDED',
    members: [
      { email: 'daeun', name: '윤다은', role: 'OWNER' },
      { email: 'jimin', name: '박지민', role: 'MEMBER' }, // 누리커머스에도 소속 — 계정은 하나, 소속은 둘
    ],
  },
  {
    name: '다온헬스케어',
    slug: 'daon-healthcare',
    status: 'ACTIVE',
    members: [
      { email: 'jiwoo', name: '서지우', role: 'OWNER' },
      { email: 'dohyun', name: '임도현', role: 'MEMBER' },
    ],
  },
  {
    name: '푸른교육',
    slug: 'pureun-edu',
    status: 'DELETED',
    members: [{ email: 'eunbi', name: '조은비', role: 'OWNER' }],
  },
];

/**
 * 운영자 매뉴얼 촬영 스택의 API 포트 — DB 5446 · API 6166 · 운영자 콘솔 6275. 시드는 이 포트에만 붙는다(README 「운영자 매뉴얼 다시 찍기」).
 * 6060(개발용 공유 API)·6160(다른 세션의 격리 스택) 같은 다른 스택은 허용 목록이 아니므로 자연히 거부된다.
 */
export const OPERATOR_STACK_API_PORT = '6166';

/**
 * 시드 대상 API 가 운영자 매뉴얼용 격리 스택인지 판정한다(순수 함수). 시드는 빈 DB 의 첫 가입자를 슈퍼어드민으로 만들므로,
 * 공유 개발 DB(막 초기화돼 가입이 열린 상태 포함)·다른 세션의 스택·원격 서버에 돌면 슈퍼어드민 자리를 가상 계정이 차지한다.
 * 그래서 localhost(127.0.0.1·::1 포함)이면서 포트가 OPERATOR_STACK_API_PORT 인 주소만 허용한다.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkIsolatedApi(apiUrl) {
  let u;
  try {
    u = new URL(apiUrl);
  } catch {
    return { ok: false, reason: `MANUAL_API 가 올바른 주소가 아닙니다: ${apiUrl}` };
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) {
    return { ok: false, reason: `격리 로컬 스택(localhost)에서만 돌립니다: ${u.hostname}` };
  }
  if (u.port !== OPERATOR_STACK_API_PORT) {
    return { ok: false, reason: `운영자 매뉴얼 스택의 API 포트(${OPERATOR_STACK_API_PORT})에서만 돌립니다: ${u.port || '(기본 포트)'}` };
  }
  return { ok: true };
}
