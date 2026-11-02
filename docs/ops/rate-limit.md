# 공개 경로 속도 제한 — 지금 구성과 여러 대로 늘릴 때 고려할 점

WP-763에서 넣은 IP 단위 속도 제한이 어떻게 동작하는지 정리합니다. api를 여러 대(multi-instance)로 늘릴 때 무엇을 바꿔야 하는지도 함께 적습니다. 다른 앱의 메모리 상태까지 모은 목록은 [multi-instance.md](multi-instance.md)에 있습니다.

## 지금 구성(api 1대 기준)

- **위치**: 앱 필터 `PublicRateLimitFilter`입니다(`apps/workplace-api/.../global/security/ratelimit/`). CORS 필터 바로 뒤, 인증 필터보다 앞에서 거릅니다.
- **대상**: 인증 없이 비밀번호 해시(bcrypt, 요청당 약 0.1초 CPU)를 계산하는 경로와, 인증 없이 요청마다 디스크를 읽는 공개 아바타 이미지(WP-1222)입니다.

  | 정책 | 경로 | 기본 한도(같은 IP) |
  |---|---|---|
  | `LOGIN` | `POST /api/v1/auth/login`, `POST /api/v1/auth/signup`, `POST /api/platform/auth/login` | 1분에 20회 |
  | `SHARE_PASSWORD` | `GET /api/v1/public/drive/share/{token}/download` — `X-Share-Password(-Encoded)` 헤더가 있을 때만 | 1분에 10회 |
  | `AVATAR` | `GET`·`HEAD /api/v1/avatars/**` — 공개 아바타 이미지. 한 화면이 처음 열릴 때 아바타를 한꺼번에 받고 회사 NAT 뒤에서는 IP 를 나눠 쓰므로 넉넉하게 둡니다(이미지는 브라우저가 영구 캐시) | 1분에 1200회 |

- **알고리즘**: 키(정책+IP)마다 토큰 버킷을 하나씩 둡니다(`TokenBucketLimiter`). 한 번에 한도만큼 몰아 보낼 수 있고, 그 뒤로는 1분에 한도만큼의 비율로 고르게 다시 찹니다. 한도를 넘기면 `429`, `Retry-After`(초), 그리고 한국어 안내 「요청이 너무 많습니다. 잠시 후 다시 시도하세요.」를 돌려줍니다.
- **상태**: api 인스턴스의 **메모리**에 둡니다. 재시작하면 비워집니다. 키가 1만 개를 넘으면 다 찬(오래 쓰지 않은) 버킷을 지워 메모리가 끝없이 커지지 않게 합니다.
- **클라이언트 IP**: 감사 로그와 같은 판정(`ClientIpExtractor`, WP-1317)을 씁니다. 접속 주소가 믿는 프록시(기본: 사설·CGNAT·루프백 등 내부 대역)면 `X-Forwarded-For`를 **오른쪽부터 걷어** 믿는 프록시가 아닌 첫 주소를 씁니다. 그보다 왼쪽(바깥에서 보낸 값)은 보지 않고, 접속 주소가 바깥이면 헤더를 보지 않고 접속 주소를 씁니다. 판정 결과가 루프백(127.0.0.1·::1)이면 로컬 도구와 테스트이므로 제한하지 않습니다. 자세한 경로는 아래 「클라이언트 IP 판정」.
- **믿는 프록시 대역**(`app.client-ip.trusted-proxies`, CIDR 목록, 생략 가능): 비우면 내부 대역 전체를 믿습니다. 클러스터 파드·서비스 대역만 믿게 좁히려면 예: `APP_CLIENTIP_TRUSTEDPROXIES=10.244.0.0/16,10.96.0.0/12`. 잘못된 값이면 api 가 기동하지 않습니다.
- **설정**(`app.rate-limit`, 모두 생략 가능):
  - `enabled`(기본 `true`)
  - `login-per-minute`(기본 `20`)
  - `share-password-per-minute`(기본 `10`)
  - `avatar-per-minute`(기본 `1200`)

  환경 변수로는 `APP_RATELIMIT_ENABLED`, `APP_RATELIMIT_LOGINPERMINUTE`, `APP_RATELIMIT_SHAREPASSWORDPERMINUTE`, `APP_RATELIMIT_AVATARPERMINUTE`처럼 씁니다. Spring 규칙에 따라 점은 `_`로 바꾸고 `-`는 뺍니다.

## 여러 대로 늘릴 때 고려할 점

### 1. 한도가 「대수 × 한도」가 된다

버킷이 인스턴스마다 따로 있습니다. 인그레스가 요청을 고르게 나누면 같은 IP가 실제로 받는 한도는 대략 `대수 × 한도`가 됩니다. 처리 방법은 둘 중 하나입니다.

- **잠깐 쓰는 방법**: 인스턴스당 한도를 `한도 ÷ 대수`로 낮춥니다. 예를 들어 3대면 `login-per-minute: 7`로 둡니다. 다만 요청이 고르게 나뉘지 않으면 한도가 들쭉날쭉합니다.
- **제대로 하는 방법**: 버킷을 **공유 저장소**로 옮깁니다(아래 2).

### 2. 공유 저장소 선택

| 저장소 | 장점 | 단점 |
|---|---|---|
| **Redis**(권장) | 원자적 증가(`INCR`+`EXPIRE`, 또는 Lua 스크립트로 토큰 버킷)가 빠릅니다. TTL로 정리가 저절로 됩니다. Bucket4j `bucket4j-redis`(Lettuce·Redisson) 어댑터를 그대로 쓸 수 있습니다. | 운영 구성(Helm)에 Redis를 하나 더 두고 관리해야 합니다. |
| **PostgreSQL** | 이미 있는 DB라 새 구성 요소가 필요 없습니다. Bucket4j `bucket4j-postgresql` 어댑터가 있습니다. | 요청마다 쓰기·잠금이 생깁니다. 로그인이 몰리면 DB 커넥션 풀을 함께 소모해, WP-752에서 막은 풀 고갈이 다시 생길 수 있습니다. 쓴다면 별도 커넥션 풀과 짧은 타임아웃이 필요합니다. |

- 옮길 때는 `TokenBucketLimiter`를 인터페이스 뒤로 빼고, 구현만 바꿉니다(메모리 → Redis). `PublicRateLimitFilter`와 정책·키 규칙은 그대로 둡니다.
- **저장소 장애 시 동작**을 정해야 합니다. 추천은 **fail-open**(저장소가 응답하지 않으면 제한 없이 통과하고 로그만 남김)입니다. 로그인 자체가 막히는 것보다 낫기 때문입니다. 계정별 잠금(5회·15분)은 DB에 있어 그대로 동작합니다.
- 키에는 TTL(예: 2분)을 붙여 오래된 키가 남지 않게 합니다.

### 3. 클라이언트 IP 판정

실제 요청 경로는 **앞단 LB → 노드 NodePort → ingress-nginx → web nginx(`/api/`) → api** 입니다. 각 단계에서 `X-Forwarded-For`는 이렇게 됩니다.

| 단계 | 하는 일 | api 가 받는 `X-Forwarded-For` (예) |
|---|---|---|
| 노드 NodePort | `externalTrafficPolicy: Cluster` 면 kube-proxy 가 출발지를 노드 주소(cilium_host)로 바꿉니다 | — |
| ingress-nginx | `use-forwarded-headers` 가 꺼져 있으면 받은 값을 버리고 접속 주소로 새로 시작합니다 | `10.244.3.206`(노드 주소) |
| web nginx | `$proxy_add_x_forwarded_for` 로 ingress 파드 주소를 덧붙입니다 | `10.244.3.206, 10.244.4.57` |

- 앱은 오른쪽부터 내부 주소를 걷으므로 web nginx 가 붙인 ingress 파드 주소(`10.244.4.57`)는 건너뜁니다. web nginx 의 `real_ip_header`·`set_real_ip_from` 은 쓰지 않습니다 — 앱 판정 하나로 충분하고, ingress 대역을 nginx 와 앱 두 곳에 적어 두면 어긋나기 쉽습니다(WP-1317).
- **인프라가 실제 주소를 넘기기 전**에는 모든 주소가 내부라 가장 왼쪽(노드 주소)이 클라이언트로 판정됩니다 — 노드마다 버킷 하나(사용자별 아님). 사용자별로 세려면 실제 클라이언트 IP 가 ingress 까지 와야 합니다(사람이 클러스터에서 할 일).
  - (가) `ingress-nginx-controller` 서비스를 `externalTrafficPolicy: Local` 로 — 컨트롤러가 없는 노드로 간 요청이 버려지므로 컨트롤러를 노드마다(DaemonSet 등) 둡니다.
  - (나) 앞단 LB 가 proxy-protocol 이나 `X-Forwarded-For` 를 넘기면 ingress-nginx ConfigMap 에 `use-proxy-protocol` 또는 `use-forwarded-headers` + `proxy-real-ip-cidr`(LB 대역)을 켭니다. LB 가 출발지를 바꾸는 방식이면 (가)만으로는 LB 주소만 보여 (나)가 필요합니다.
  - 반영 뒤 운영 감사 로그(`audit_log.ip_address`)에 실제 외부 IP 가 찍히는지 확인합니다.
- 앞에 **다른 프록시나 로드밸런서**(CDN·클라우드 LB)가 더 붙어도, 그 주소가 믿는 대역(내부 대역 또는 `app.client-ip.trusted-proxies`)에 들면 같은 규칙으로 걷힙니다. 공인 주소를 가진 프록시면 그 대역을 `trusted-proxies` 에 넣습니다(넣으면 기본 내부 대역은 믿지 않으니 클러스터 대역도 함께 적습니다).
- 사내 NAT 뒤 사용자는 모두 같은 IP로 보입니다. 사내 사용자가 많다면 한도를 넉넉히 두거나, 사내 대역을 예외 목록으로 받는 설정을 더합니다.

### 4. 인그레스에서 한 겹 더(선택)

여러 대로 늘리는 시점에는 ingress-nginx의 `limit-rps`·`limit-connections`로 거친 상한을 한 겹 더 두는 것도 고려합니다.

- 주석은 Ingress 단위입니다. 그래서 로그인 경로만 따로 떼어 낸 Ingress에 걸어야 하고, 지금처럼 web·api가 한 Ingress에 묶여 있으면 모든 요청이 함께 제한됩니다.
- 인그레스 상한은 앱보다 넉넉하게 두어, 세밀한 판정은 앱이 하게 합니다.

### 5. 관측

- 거절할 때마다 api 로그에 `공개 경로 속도 제한 — policy=… ip=… uri=…`(WARN)를 남깁니다. 여러 대에서는 로그를 모아 IP별 거절 수를 볼 수 있게 합니다.
- 공유 저장소로 옮기면 저장소 지연과 실패 수도 지표로 남깁니다(fail-open이 조용히 계속되지 않게).

## 바꿀 때 체크리스트

- [ ] 대수에 맞춰 인스턴스당 한도를 조정했거나, 공유 저장소로 옮겼다
- [ ] 저장소 장애 시 fail-open 동작을 테스트했다
- [ ] 앞단 프록시 구성에 맞게 클라이언트 IP 판정을 확인했다(격리 스택이나 스테이징에서 `X-Forwarded-For`로 확인)
- [ ] `PublicRateLimitFilterTest`(429·Retry-After·IP별 분리)를 새 구현에서도 통과시켰다
