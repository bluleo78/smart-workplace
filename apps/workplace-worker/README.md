# workplace-worker

파일 텍스트 추출 Python 워커 서비스 (FastAPI, 포트 6080).

api 가 Drive 파일을 업로드하면 `file_extraction` 큐에 PENDING 작업을 삽입하고,
worker 에 `POST /internal/extract` 디스패치를 보낸다.
worker 는 업로드 볼륨에서 파일을 직접 읽어 텍스트를 추출한 뒤
`POST /internal/extract/{jobId}/callback` 으로 결과를 api 에 돌려보낸다.

## 로컬 개발 실행

workplace-worker 는 Python 서비스이므로 pnpm/turbo 워크스페이스 밖에서 별도로 실행한다.
(root `pnpm dev` 는 Node 앱만 기동하며 6080 포트는 free 처리만 한다.)

### 의존 설치

```bash
cd apps/workplace-worker
pip install -e ".[dev]"   # pyproject.toml extras
# 또는
pip install fastapi "uvicorn[standard]" pymupdf python-docx openpyxl httpx python-pptx pillow pillow-heif
```

### 환경변수

| 변수 | 설명 | 예시 |
|------|------|------|
| `WORKER_BLOB_BASE` | api 가 파일을 저장하는 uploadDir 절대 경로 | `/Users/yourname/project/upload-data` |
| `WORKPLACE_API_BASE_URL` | api 루트 URL(콜백 `/internal/worker/**` 는 루트 경로 — `/api/v1` 을 붙이면 콜백이 거부돼 추출이 EXTRACTING 에서 멈춘다) | `http://localhost:6060` |
| `INTERNAL_SERVICE_TOKEN` | api / ai-agent 와 동일한 내부 서비스 토큰 | *(비밀값 — .env 에만 기록)* |
| `WORKPLACE_CONVERTER_URL` | 문서 변환 서비스(workplace-converter) 루트 URL — 레거시 형식 추출에 필요. 비우면 기동은 되고 `.doc/.ppt/.xls/.hwp` 추출만 에러 로그와 함께 보류(콜백 없음 → api 리스 재시도) | `http://localhost:6085` |
| `WORKER_CONVERTER_CONCURRENCY` | 워커 → converter 동시 호출 상한(기본 1, 1 이상 — 아니면 기동 실패) | `1` |
| `WORKER_CONVERTER_ACQUIRE_TIMEOUT_SEC` | converter 동시 호출 슬롯 대기 상한 초(기본 30 — 넘기면 일시 오류로 보류) | `30` |
| `WORKER_CONVERTER_READ_TIMEOUT_SEC` | converter 호출 read 타임아웃 초(기본 90 — converter 변환 타임아웃 60s 보다 길게) | `90` |

레거시 `.doc/.ppt/.xls`·`.hwp` 텍스트 추출은 워커가 직접 하지 않고 converter `POST /convert/text` 를 경유한다(워커 이미지에 LibreOffice 없음).

로컬 `.env` 예시:

```dotenv
WORKER_BLOB_BASE=/Users/yourname/git/smart-workplace/upload-data
WORKPLACE_API_BASE_URL=http://localhost:6060
INTERNAL_SERVICE_TOKEN=dev-secret-token
WORKPLACE_CONVERTER_URL=http://localhost:6085
```

### 실행

```bash
cd apps/workplace-worker
# .env 로드 후 기동 (--reload: 코드 변경 시 자동 재시작)
set -a && source .env && set +a
uvicorn app.main:app --reload --port 6080
```

헬스체크: `curl http://localhost:6080/health`

## 운영 배포 토폴로지

api 와 worker 는 **동일한 업로드 볼륨**을 공유해야 한다.

```
api  ──rw──► [uploads-data volume] ◄──ro── worker
              /data/uploads                /data/uploads (읽기 전용)
```

- `api` 컨테이너: `/data/uploads` (읽기/쓰기)
- `worker` 컨테이너: `/data/uploads:ro` (읽기 전용)
- `WORKER_BLOB_BASE=/data/uploads` 를 worker 에 주입
- worker → api 콜백에 `WORKPLACE_API_BASE_URL=http://api:9090` 사용(루트 — 콜백 경로 `/internal/worker/**` 에 `/api/v1` 이 붙지 않는다)
- `INTERNAL_SERVICE_TOKEN` 은 api 의 `WORKPLACE_AI_AGENT_TOKEN` 과 **동일 값** 사용

운영은 K8S 로 배포한다(이미지 빌드는 ghcr 푸시만, 옛 compose·deploy.sh 배포는 폐기). worker 쪽 K8S 주의:

- env `WORKPLACE_CONVERTER_URL=http://converter:7085` 주입 — 없으면 레거시 `.doc/.ppt/.xls/.hwp` 텍스트 추출이 보류된다.
- `INTERNAL_SERVICE_TOKEN` 은 converter 와도 **동일 값** 사용(converter 가 `Authorization: Internal <token>` 을 검사 — 불일치면 401 → 추출 보류).
- converter 의 NetworkPolicy 가 worker 파드로부터의 ingress 를 허용해야 한다(막히면 연결 실패 → 추출 보류).
- 배포 순서 **converter → worker → api**. api 의 V184 마이그레이션(HWP 추출 재큐)은 일회성이라, 새 worker 보다 먼저 나가면
  구 LibreOffice 워커가 재큐 행을 다시 실패시키고 재큐가 소모된다.

## 라이브 스모크 테스트

```bash
# api + worker + ai-agent 기동 후 Drive 파일 업로드 (인증 필요)
# 업로드 후 file_extraction 테이블 폴링:
psql -h localhost -p 5434 -U app -d workplace \
  -c "select status, char_count, left(summary, 40) from file_extraction order by file_id desc limit 3;"
# 기대: PENDING → EXTRACTING → TEXT_READY → SUMMARIZING → DONE, summary IS NOT NULL
```

worker 가 다운되면 PENDING 누적 → worker 재기동 후 스케줄러(3분 주기)가 백필 흡수.
