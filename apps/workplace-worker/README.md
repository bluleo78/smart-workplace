# workplace-worker

파일 텍스트 추출 Python 워커 서비스 (FastAPI, 포트 7080).

api 가 Drive 파일을 업로드하면 `file_extraction` 큐에 PENDING 작업을 삽입하고,
worker 에 `POST /internal/extract` 디스패치를 보낸다.
worker 는 업로드 볼륨에서 파일을 직접 읽어 텍스트를 추출한 뒤
`POST /internal/extract/{jobId}/callback` 으로 결과를 api 에 돌려보낸다.

## 로컬 개발 실행

workplace-worker 는 Python 서비스이므로 pnpm/turbo 워크스페이스 밖에서 별도로 실행한다.
(root `pnpm dev` 는 Node 앱만 기동하며 7080 포트는 free 처리만 한다.)

### 의존 설치

```bash
cd apps/workplace-worker
pip install -e ".[dev]"   # pyproject.toml extras
# 또는
pip install fastapi "uvicorn[standard]" pymupdf python-docx openpyxl httpx
```

### 환경변수

| 변수 | 설명 | 예시 |
|------|------|------|
| `WORKER_BLOB_BASE` | api 가 파일을 저장하는 uploadDir 절대 경로 | `/Users/yourname/project/upload-data` |
| `WORKPLACE_API_BASE_URL` | api 내부 베이스 URL | `http://localhost:9090/api/v1` |
| `INTERNAL_SERVICE_TOKEN` | api / ai-agent 와 동일한 내부 서비스 토큰 | *(비밀값 — .env 에만 기록)* |

로컬 `.env` 예시:

```dotenv
WORKER_BLOB_BASE=/Users/yourname/git/smart-workplace/upload-data
WORKPLACE_API_BASE_URL=http://localhost:9090/api/v1
INTERNAL_SERVICE_TOKEN=dev-secret-token
```

### 실행

```bash
cd apps/workplace-worker
# .env 로드 후 기동 (--reload: 코드 변경 시 자동 재시작)
set -a && source .env && set +a
uvicorn app.main:app --reload --port 7080
```

헬스체크: `curl http://localhost:7080/health`

## 운영 배포 토폴로지

api 와 worker 는 **동일한 업로드 볼륨**을 공유해야 한다.

```
api  ──rw──► [uploads-data volume] ◄──ro── worker
              /data/uploads                /data/uploads (읽기 전용)
```

- `api` 컨테이너: `/data/uploads` (읽기/쓰기)
- `worker` 컨테이너: `/data/uploads:ro` (읽기 전용)
- `WORKER_BLOB_BASE=/data/uploads` 를 worker 에 주입
- worker → api 콜백에 `WORKPLACE_API_BASE_URL=http://api:9090/api/v1` 사용
- `INTERNAL_SERVICE_TOKEN` 은 api 의 `WORKPLACE_AI_AGENT_TOKEN` 과 **동일 값** 사용

운영 `docker-compose.prod.yml` 에 `worker` 서비스와 `uploads-data` 명명 볼륨이 이미 선언되어 있다.

### ghcr 이미지 빌드

```bash
# scripts/deploy.sh 에 worker 이미지 빌드 추가 필요:
docker buildx build --platform linux/amd64,linux/arm64 \
  -t ghcr.io/bluleo78/smart-workplace/worker:latest \
  --push \
  apps/workplace-worker
```

## 라이브 스모크 테스트

```bash
# api + worker + ai-agent 기동 후 Drive 파일 업로드 (인증 필요)
# 업로드 후 file_extraction 테이블 폴링:
psql -h localhost -p 5434 -U app -d workplace \
  -c "select status, char_count, left(summary, 40) from file_extraction order by file_id desc limit 3;"
# 기대: PENDING → EXTRACTING → TEXT_READY → SUMMARIZING → DONE, summary IS NOT NULL
```

worker 가 다운되면 PENDING 누적 → worker 재기동 후 스케줄러(3분 주기)가 백필 흡수.
