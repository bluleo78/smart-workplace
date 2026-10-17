# workplace-converter

문서 변환 서비스 (Python/FastAPI, 로컬 포트 6085 · 컨테이너 7085). WP-430.

HWP·HWPX·PPTX·PPT·DOC 원본 바이트를 받아 PDF(또는 텍스트)로 돌려준다. 상태 없음 — DB·스토리지·콜백 없음.

## API

모든 `/convert/*` 는 `Authorization: Internal <INTERNAL_SERVICE_TOKEN>` 필요. `/health` 는 무인증.

- `POST /convert/pdf?mime=<mime>` (본문 `application/octet-stream`) → `200 application/pdf` + `X-Page-Count`
- `POST /convert/text?mime=<mime>` → `200 text/plain; charset=utf-8` (최대 `CONVERTER_MAX_TEXT_CHARS` 글자, 기본 1,000,000 — 넘으면 잘라서 반환)
- `GET /health` → `200 {"ok": true}` · 상주 soffice 가 죽어 있고 재기동도 실패하면 `503 {"ok": false, ...}`

오류 본문 `{"detail": {"code": "<CODE>"}}`:

| 상태 | code | 의미 |
|---|---|---|
| 401 | — | 미인증 |
| 415 | `UNSUPPORTED` | 미지원 형식 |
| 413 | `TOO_LARGE` | 입력 상한 초과(`CONVERTER_MAX_BYTES`, 기본 100MB) |
| 422 | `TOO_MANY_PAGES` | 출력 쪽수 초과(`CONVERTER_MAX_PAGES`, 기본 500). HWP 는 rhwp SVG 수로 PDF 합치기·텍스트 추출 전에 판정(HWP 텍스트 요청도 같은 상한) |
| 422 | `CONVERT_FAILED` | 변환 실패(손상 파일·0쪽 결과 등) |
| 429 | `BUSY` | 처리 중(soffice 동시 1건 · rhwp 슬롯 `CONVERTER_RHWP_SLOTS`). 본문을 받기 전에 먼저 판정 |
| 500 | `INTERNAL` | 예상 못한 서버 오류(코드 결함) — 원인 불명이므로 재시도 가능으로 본다(입력 문제 422 와 구분) |
| 503 | `UNAVAILABLE` | 일시적 인프라 오류(soffice 기동 실패·UNO 연결 실패·변환 중 soffice 사망) — 입력 문제 아님, 재시도 가능 |
| 504 | `TIMEOUT` | 변환 타임아웃(`CONVERTER_TIMEOUT_SEC`, 기본 60 — soffice 지연 기동 시간 포함) |

## 로컬 실행·테스트

LibreOffice·rhwp·rsvg-convert·폰트가 이미지에 모여 있으므로 로컬 실행도 컨테이너로 한다.

```bash
cd apps/workplace-converter
pnpm dev          # 이미지 빌드 → smart-workplace-converter-dev 컨테이너(127.0.0.1:6085 루프백 전용, 읽기 전용 루트 FS + /tmp tmpfs)
                  # ../../.env 를 읽고 INTERNAL_SERVICE_TOKEN 이 없으면 WORKPLACE_AI_AGENT_TOKEN → changeme-local
pnpm test         # uv run pytest -q -m "not engine" (호스트, 엔진 가짜)
pnpm test:engine  # docker build --target test — 이미지 안에서 engine 마커 포함 전체 pytest, 빌드 성공 = 통과
```

`engine` 마커 테스트는 실제 rhwp/soffice 가 필요하므로 컨테이너 test 타깃에서만 돈다.

## 이미지

- `Dockerfile` 스테이지: `lock`(빌드 머신 네이티브에서 uv.lock → 해시 고정 requirements — 에뮬레이션 대상에서 uv 를 돌리지 않음, WP-437) · `build`(런타임 venv, pip 해시 검증 설치) · `build-dev`(+dev 그룹) · `rhwp`(TARGETARCH 별 바이너리 + sha256 검증) · `os`(DHI 데비안 베이스 + python3·LibreOffice·python3-uno·rsvg-convert·폰트) · `base`(os + rhwp + 실행 환경) · `test` · `runtime`(기본 타깃).
- 런타임: `dhi.io/debian-base:trixie-dev`(Docker Hardened Images 의 셸·apt 포함 -dev 변형 — distroless 아님, apt 로 LibreOffice 등 설치) + 시스템 python3(데비안 3.13 — 앱 venv·UNO 헬퍼 공용), uid 65532, `HOME=/tmp`·`TMPDIR=/tmp`(쓰기는 `/tmp` 만), 포트 7085.
- 배포 이미지: `docker.io/iacloudops/genia-works-converter` — 릴리스 태그(`vX.Y.Z`) 의 GitLab 파이프라인이 빌드한다(`deploy/release/`, `docs/ops/release.md`).

## 운영 배포 노트 (K8S)

compose 서비스는 없고 K8S 로만 배포한다(매니페스트는 `deploy/helm/templates/converter-*.yaml`, WP-438).

- **Deployment**: replicas ≥ 2. 컨테이너 포트 7085, 환경변수 `INTERNAL_SERVICE_TOKEN`(필수, api·worker 와 같은 값).
  - resources: memory request `768Mi` / limit `1.5Gi`, cpu request `1`.
  - securityContext: `runAsNonRoot: true`, `runAsUser: 65532`, `readOnlyRootFilesystem: true`.
  - volume: `/tmp` 에 `emptyDir`(`medium: Memory`, `sizeLimit: 1Gi`) — LibreOffice 프로필·fontconfig 캐시·요청 임시 파일이 모두 여기 쓰인다.
  - readinessProbe: `GET /health` (무인증). soffice 가 죽어 있으면 그 자리에서 재기동을 시도하므로 최대 ~20초 걸릴 수 있다 —
    `timeoutSeconds: 25` 이상으로 둔다(기본 1초면 재기동 중 실패로 판정). 재기동마저 실패하면 503 이라 트래픽에서 빠진다.
  - 환경변수 `INTERNAL_SERVICE_TOKEN` 이 비었거나 공백뿐이면 기동이 실패한다(빈 토큰 인증 통과 방지).
- **Service**: `converter`, 포트 7085, 클러스터 내부 전용(ClusterIP).
- **NetworkPolicy**: ingress 는 api·worker Pod 에서만 7085 허용. **egress 전면 차단** — 변환에 외부 통신이 필요 없고, 문서 안 외부 링크·매크로가 밖으로 나가지 못하게 한다.
- **HPA**: CPU 70%, min 2 · max 6. Pod 당 soffice 동시 1건이라 바쁘면 `429 BUSY` → 호출자가 짧게 재시도하면 다른 Pod 로 간다.
- **호출자 설정**: api·worker 에 `WORKPLACE_CONVERTER_URL=http://converter:7085` 주입.
