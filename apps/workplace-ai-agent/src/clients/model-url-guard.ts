// 사용자 지정 모델 서버 주소(baseURL)로 나가는 요청의 SSRF 가드(WP-596).
// 개인 비서·AI 구성원의 baseURL 은 사용자가 적는 값이고, ai-agent 는 클러스터 안에서 돌아 서버 자신(127.x)·클라우드 메타데이터(169.254.x)·
// 사내망(10.x 등)에 닿는다. workplace-api 가 저장·프로브 전에 같은 규칙으로 막지만, 이름은 요청 순간 다시 풀리므로(DNS 재바인딩)
// 실제로 접속하는 이 프로세스에서도 ① IP 리터럴 주소 ② 접속 직전 DNS 결과를 검사하고 ③ 리다이렉트를 따라가지 않는다.
// 예외는 우리 운영자만 바꾸는 환경 변수 MODEL_URL_ALLOWED_HOSTS(쉼표 구분 호스트 이름·IP, 기본 비어 있음) — 사내 LLM 전용 설치용.
import { type LookupAddress, promises as dnsPromises } from 'node:dns';
import { isIP } from 'node:net';

import type { LookupAddressEntry } from 'axios';

/** 막힌 주소로 나가려 할 때 던진다 — 라우트는 이 오류를 사용자에게 「내부망 주소」 안내로 바꾼다. */
export class BlockedModelHostError extends Error {
  constructor(host: string) {
    super(`내부망 주소로는 모델 서버에 접속할 수 없습니다: ${host}`);
    this.name = 'BlockedModelHostError';
  }
}

/** 운영자 허용 목록 — 매 호출 읽는다(테스트·설정 변경이 재시작 없이 반영되게). 소문자 비교. */
export function allowedModelHosts(): Set<string> {
  return new Set(
    (process.env.MODEL_URL_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** URL 의 호스트(IPv6 대괄호 제거·소문자). */
function hostOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

/**
 * 내부 대역 IP 인가 — 루프백·사설·링크로컬(메타데이터 169.254.x 포함)·미지정·CGNAT(100.64/10)·멀티캐스트,
 * IPv6 루프백·ULA(fc00::/7)·링크로컬(fe80::/10)·IPv4 매핑(::ffff:a.b.c.d)·NAT64(64:ff9b::/96). workplace-api 의 같은 판정과 맞춘다.
 */
export function isInternalAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  if (kind === 6) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isInternalAddress(mapped[1]!);
    if (v.startsWith('64:ff9b::')) return true;
    return /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff');
  }
  // IP 가 아니면 판정 불가 — 호출부가 IP 만 넘긴다.
  return false;
}

/** IP 리터럴 호스트를 요청 전에 검사한다(리터럴은 DNS 조회를 거치지 않아 아래 lookup 가드에 걸리지 않는다). */
export function assertModelHostAllowed(url: URL): void {
  const host = hostOf(url);
  if (allowedModelHosts().has(host)) return;
  if (host === 'localhost' || host.endsWith('.localhost') || (isIP(host) && isInternalAddress(host))) {
    throw new BlockedModelHostError(host);
  }
}

/**
 * axios 의 lookup 옵션에 넣는 접속 직전 DNS 가드 — 풀린 주소 중 하나라도 내부 대역이면 접속하지 않는다. 접속은 이 결과로만 하므로
 * 검사와 접속 사이에 이름이 바뀌어도(재바인딩) 새지 않는다.
 */
export async function guardedLookup(
  hostname: string,
  _options: object,
): Promise<[LookupAddressEntry[]]> {
  const addresses = await dnsPromises.lookup(hostname, { all: true });
  if (!allowedModelHosts().has(hostname.toLowerCase()) && addresses.some((a) => isInternalAddress(a.address))) {
    throw new BlockedModelHostError(hostname);
  }
  return [addresses.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }))];
}

/**
 * fetch 처럼 lookup 을 끼울 수 없는 요청용 사전 검사 — IP 리터럴 검사에 더해 이름을 풀어 내부 대역이면 막는다. 이름이 풀리지 않으면 통과시킨다
 * (어차피 접속할 수 없다). 검사와 접속 사이 재바인딩은 남으므로 가능한 곳은 {@link MODEL_REQUEST_GUARD} 를 쓴다.
 */
export async function assertModelHostResolvesPublic(url: URL): Promise<void> {
  assertModelHostAllowed(url);
  const host = hostOf(url);
  if (isIP(host) || allowedModelHosts().has(host)) return;
  let addresses: LookupAddress[];
  try {
    addresses = await dnsPromises.lookup(host, { all: true });
  } catch {
    return;
  }
  if (addresses.some((a) => isInternalAddress(a.address))) throw new BlockedModelHostError(host);
}

/** 모델 서버로 나가는 axios 요청에 공통으로 거는 옵션 — 접속 직전 DNS 가드 + 리다이렉트 안 따라감. */
export const MODEL_REQUEST_GUARD = { lookup: guardedLookup, maxRedirects: 0 } as const;
