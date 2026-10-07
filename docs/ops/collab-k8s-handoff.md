# 노트 동기화 서버(workplace-collab) K8S 인계 메모 (WP-288)

이 저장소에는 K8S 매니페스트가 없다. 이미지는 `scripts/deploy.sh` 로 ghcr 에 빌드·푸시만 하고(`BUILD_ONLY=1 ./scripts/deploy.sh collab`),
클러스터 반영은 인프라 저장소에서 한다. 아래는 인프라 쪽에 전달할 값이다. 설계: 노트 동시 편집 스펙 §4.2·§9.

## 1. 이미지·워크로드

| 항목 | 값 |
|---|---|
| 이미지 | `ghcr.io/bluleo78/smart-workplace/collab:latest` (linux/amd64·arm64, DHI distroless node 24, UID 1000) |
| 컨테이너 포트 | `7095` (HTTP + WebSocket 한 포트) |
| replicas | **1** — 문서 상태를 프로세스 메모리에 들고 있어 다중 파드는 불가(Redis 확장은 범위 밖). HPA 금지 |
| 업데이트 전략 | `Recreate` 권장 — RollingUpdate 면 잠깐 두 파드가 같은 문서를 따로 들고 서로 덮어쓴다 |
| `terminationGracePeriodSeconds` | **30 이상**(권장 30~45). 종료 시 미저장 문서의 마지막 저장을 최대 20초(`shutdownTimeoutMs` 기본 20000) 기다리므로, 유예가 그보다 짧으면 SIGKILL 로 편집이 유실된다 |
| 리소스(초기값) | requests `cpu: 100m, memory: 256Mi` / limits `memory: 512Mi` — 열린 노트 수에 비례하므로 운영 지표로 조정 |

### 헬스 체크(probe)

런타임이 distroless(셸 없음)라 `exec` probe 는 쓸 수 없다. `httpGet` 을 쓴다.

```yaml
livenessProbe:
  httpGet: { path: /health, port: 7095 }
  periodSeconds: 10
  failureThreshold: 3
readinessProbe:
  httpGet: { path: /health, port: 7095 }
  periodSeconds: 5
```

- `GET /health` → `200 {"ok":true}`. 인증 없음, 테스트 모드와 무관, API·DB 를 부르지 않는다(프로세스가 HTTP 를 받는지만).
  API 장애로 collab 을 재시작해 봐야 접속자만 끊기므로 의존성 검사는 일부러 넣지 않았다.
- `/health` 는 아래 Ingress(`/collab`)로는 외부에 노출되지 않는다 — 클러스터 내부 probe 전용.

## 2. 환경 변수

### collab

| 변수 | 값 | 비고 |
|---|---|---|
| `PORT` | `7095` | 이미지 기본값과 같음 |
| `WORKPLACE_API_URL` | `http://<api-svc>:9090` | API 컨테이너 포트 9090 |
| `INTERNAL_SERVICE_TOKEN` | API 와 **같은** 시크릿 | 없으면 부트 거부(운영). API↔collab 양방향 `Authorization: Internal <token>` |
| `COLLAB_TEST_MODE` | 설정하지 않음 | `1` 이면 메모리 저장·인증 스텁·`/__test/*` 가 켜진다. **운영 금지** |

### api (추가)

| 변수 | 값 |
|---|---|
| `WORKPLACE_COLLAB_URL` | `http://<collab-svc>:7095` |
| `WORKPLACE_COLLAB_ENABLED` | `true` |
| `INTERNAL_SERVICE_TOKEN` | collab 과 같은 시크릿(기존 worker 와 공용 값) |

### 내부 토큰 공유에 대한 권고

현재 collab 내부 토큰은 기본적으로 api·worker(·ai-agent)가 쓰는 **단일 서비스 간 토큰과 같은 값**이다
(api `workplace.collab.internal-token` = `${INTERNAL_SERVICE_TOKEN:${WORKPLACE_AI_AGENT_TOKEN:}}`).
그 토큰을 가진 쪽은 누구든 collab 의 `/internal/docs/*`(모든 테넌트 노트 본문 덮어쓰기·연결 재검증)와
API 의 노트 문서 내부 엔드포인트(모든 테넌트 노트 상태 읽기·쓰기)를 부를 수 있다. 즉 worker·ai-agent 가 탈취되면 노트 전체가 노출된다.

- **권고**: collab 전용 시크릿을 따로 발급해 api 의 `workplace.collab.internal-token` 과 collab 의 `INTERNAL_SERVICE_TOKEN` 에만 주입한다.
  지금은 api 쪽 전용 env 이름이 없으므로(공용 `INTERNAL_SERVICE_TOKEN` 을 읽음) 적용하려면 api 에 전용 env(예: `WORKPLACE_COLLAB_INTERNAL_TOKEN`)를
  추가하는 후속 작업이 필요하다. 출시 차단 사항은 아니다(내부망 전용·토큰 비교는 상수 시간).
- 어느 경우든 시크릿은 K8S Secret 으로 주입하고 ConfigMap·이미지에 넣지 않는다.

## 3. Service·Ingress

- Service: `ClusterIP`, port `7095` → targetPort `7095`.
- Ingress: 웹과 **같은 호스트**에 path `/collab`(`pathType: Prefix`) → collab Service. 웹 Ingress 와 **별도 Ingress 리소스**로 둔다
  (WebSocket 장시간 연결용 타임아웃을 이 경로에만 적용하기 위해).

```yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
spec:
  rules:
    - host: <web-host>
      http:
        paths:
          - path: /collab
            pathType: Prefix
            backend: { service: { name: <collab-svc>, port: { number: 7095 } } }
```

- 웹은 `wss://<web-host>/collab` 으로 접속한다(`collabSession.ts`). 별도 호스트·CORS 설정 불요.
- **`/internal` 은 외부에 노출하지 않는다** — Ingress 에 `/collab` 외 경로를 추가하지 말 것. `/internal/*` 은 클러스터 내부(api → collab)에서만 부른다.
- sticky session 불요(파드 1개).

## 4. 배포 순서·게이트

1. **api** — 노트 문서 저장소·내부 엔드포인트와 `WORKPLACE_COLLAB_*` env 가 먼저 있어야 collab 이 문서를 불러오고 저장한다.
2. **collab** — `/health` 200 확인.
3. **web** — 실시간 편집 UI. 이전 웹(캐시된 PWA)의 전체 본문 PUT 은 API 가 collab 으로 반영한다.

- **WP-289(AI 병합 경로)와 함께 배포한다** — 배포 게이트. 단독 배포하지 않는다.
- 출시 전 드라이런(WP-286): 운영 DB 사본에서 `apps/workplace-collab/scripts/export-wiki-bodies.sql` → `pnpm --filter @smart-workplace/workplace-collab dryrun <bodies.json>`
  으로 왕복 차이를 확인한다(쓰기 없음). 결과 파일에는 실제 노트 내용이 담기므로 공유하지 않는다.

## 5. 운영 메모

- collab 재시작 = 모든 접속자 재연결(클라이언트가 미전송분을 다시 보낸다). 종료 시 미저장 문서를 저장하고 내려가며, 20초 안에 끝나지 않으면
  로그에 `UNSAVED documents` 를 남긴다 — 이 로그가 보이면 유예 시간·API 상태를 확인한다.
- 로그는 stdout(`[collab] ...`).
