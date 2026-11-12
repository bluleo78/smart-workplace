# WP-1519 드라이브 동영상 업로드 상한 1GB

## 목표

600~900MB 동영상을 드라이브에 올릴 수 있게 한다. 경로의 모든 단(웹 사전 검사 → ingress → 웹 nginx → API 멀티파트 → 범주 상한)을
동영상 1GB 에 맞추고, 동영상이 아닌 형식의 **실효 상한은 그대로** 둔다. 이어 올리기(청크)는 범위 밖(후속 스토리).

## 바꾸는 파일

| 파일 | 내용 |
|---|---|
| `apps/workplace-api/.../file/service/FileUploadService.java` | VIDEO 범주(1GB) — `video/*` 전부(매개변수·대소문자 무시). DATA 256MB → 100MB(아래 결정 1) |
| `apps/workplace-api/.../file/service/MimeNormalizer.java` | 동영상 확장자(mp4·m4v·mov·webm·mkv·avi·wmv·flv·mpeg/mpg·3gp·ogv·mts/m2ts) → MIME 폴백 |
| `apps/workplace-api/.../drive/service/DriveStagedUpload.java`(새) · `UploadSource.java` · `DriveFileController` · `DriveTransferLinkService` | blob 먼저 쓰기(결정 8) |
| `apps/workplace-api/.../file/exception/FileSizeLimitExceededException.java` | VIDEO → 「동영상」, 1GB 이상은 「1GB」로 표기 |
| `apps/workplace-api/.../mail/service/MailAttachmentDriveSaveService.java` | 메일 첨부 저장은 메모리 바이트 경로라 100MB 로 묶는다(결정 3) |
| `apps/workplace-api/.../drive/service/DriveUploadLimits.java` · `DriveUploadLinkResponse.java` | 주석(멀티파트 1GB) |
| `apps/workplace-api/src/main/resources/application.yml` | multipart `max-file-size` 1GB, `max-request-size` 1100MB |
| `deploy/helm/values.yaml` · `templates/ingress.yaml` | `proxyBodySize` 1100m, 요청 버퍼링 끔, send/read timeout 600s |
| `deploy/helm/values.prod.yaml` | 저장 볼륨 주석(단일 100MB → 동영상 1GB) |
| `apps/workplace-web/nginx.conf` · `apps/workplace-admin/nginx.conf` | `client_max_body_size 1100m`, `/api/` 요청 버퍼링 끔 |
| `apps/workplace-web/src/pages/drive/uploadLimit.ts`(새) · `DrivePage.tsx` | 파일별 사전 검사 상한(동영상 1GB, 그 외 100MB) |
| `apps/workplace-web/src/components/drive/DriveThumbnail.tsx` | 동영상 아이콘(`video/*` MIME 기준) |

## 내가 정한 것

1. **DATA 범주 256MB → 100MB.** 지금 DATA 256MB 는 어느 경로에서도 실효가 없다 — 직접 업로드는 멀티파트 100MB, 업로드 링크·메일 저장은
   `DriveUploadLimits` 의 min(범주, 멀티파트 100MB), 텍스트로 만들기는 TEXT 10MB 에 막힌다. 멀티파트를 1GB 로 올리면 직접 업로드에서 DATA 가
   256MB 로 늘어나므로, 범주 표에 실효값(100MB)을 적어 「동영상만 1GB」를 지킨다. 다른 범주 값(IMAGE·TEXT 10MB, PDF·DOCUMENT 100MB,
   OTHER 25MB)은 그대로.
2. **VIDEO 판정은 `video/` 접두어.** `categoryOf` 는 기본형(`baseMime` — 매개변수 떼고 소문자)이 `video/` 로 시작하면 VIDEO. 이상한 하위
   형식(`video/x-flv`, `Video/MP4; codecs=…`)도 동영상이다. 저장 MIME(브라우저 값)은 바꾸지 않는다.
3. **메일 첨부 → 드라이브 저장은 100MB 유지.** 이 경로는 원본 전체를 `byte[]` 로 받아(`UploadSource.ofBytes`) API 힙(limit 1536Mi)에 올린다.
   동영상 1GB 를 그대로 허용하면 OOM 위험 — 메일 첨부는 메일 서버 상한(수십 MB) 때문에 실제로 닿지 않는 크기이기도 하다. 업로드 링크는 임시 파일로
   스트리밍하므로 동영상 1GB 를 받는다.
4. **확장자 폴백.** 빈 Content-Type·`application/octet-stream` + `.mp4` 는 지금 OTHER(25MB)로 떨어진다(`curl -T` 업로드 링크, 확장자를 모르는
   브라우저·OS 의 .mkv 등). `MimeNormalizer.EXTENSION_TO_MIME` 에 동영상 확장자를 더한다. 기존 행 백필은 하지 않는다(이미지 V174 와 달리 범주·미리보기에
   영향이 없어서 — 아이콘은 MIME 으로 고른다).
5. **마이그레이션 불필요.** `file.category` 는 `VARCHAR(20)` 이고 CHECK 가 없다(V4). jOOQ·DTO 의 category 는 문자열이다.
6. **웹 사전 검사 = 파일별 상한.** 지금은 「멀티파트 상한(100MB) 초과만 미리 막고 형식별 상한은 서버 문구를 따른다」. 멀티파트가 1GB 가 되면 같은 규칙으로는
   500MB PDF 를 다 올린 뒤에야 거절된다. 그래서 동영상(서버와 같은 규칙 — `file.type` 이 구체적이면 그 값, 비었거나 octet-stream 이면 확장자)은 1GB,
   그 외는 지금과 같은 100MB(동영상 외 범주의 최댓값)로 미리 막는다. 100MB 이하의 범주별 차이(OTHER 25MB 등)는 지금처럼 서버 문구를 따른다.
   안내 문구 형식(「파일 크기가 100MB를 초과합니다.」)은 그대로 — E2E `drive.spec.ts`(일반 파일 100MB+1B)가 유지된다.

7. **멀티파트를 1GB 로 올려도 다른 업로드 엔드포인트는 그대로.** 멀티파트를 받는 컨트롤러를 모두 봤다 — 이슈·채널·이슈 챗·홈·메일 작성 첨부(25MB),
   이슈 본문 이미지·노트 이미지(10MB), 아바타(5MB)는 서비스가 자기 상한을 먼저 건다. 코어 `/files`·드라이브 업로드만 범주 표를 따른다.

8. **blob 먼저 쓰기(리뷰 반영).** 드라이브 저장 핵심은 테넌트 할당량 advisory lock·DB 트랜잭션 안에서 blob 을 NFS 로 복사해, 1GB 동영상이면
   같은 테넌트의 드라이브 업로드가 몇 분씩 줄 서고 커넥션 풀이 마를 수 있었다. `DriveStagedUpload` 가 트랜잭션 밖에서 잠그지 않은 할당량 빠른 거절 →
   `FileUploadService.stage`(범주 상한 확인 뒤 blob 쓰기, `UploadSource.Staged` 로 표시) → 저장 핵심(잠금·할당량 재검사·행 삽입만, 바이트 복사 없음)
   순으로 돌리고, 저장이 실패하면 써 둔 blob 을 지운다. 멀티파트(컨트롤러)·업로드 링크 PUT(`completeUpload` 를 트랜잭션 템플릿으로 바꿈)·메일 첨부 저장
   셋 다 이 길을 탄다. 버전·동명 판정은 그대로 잠금 아래에서 한다 — blob 경로는 uuid 라 잠근 행의 지금 이름과 무관하다. 이미 트랜잭션 안에서 불리면
   (테스트·감싼 서비스) 먼저 쓰기를 하지 않는다. 한계: 쓰기와 행 삽입 사이에 프로세스가 죽으면 행 없는 blob 이 남는다(기존 경합 고아와 같은 부류).
9. **코어 임시 업로드(/api/v1/files)는 100MB 유지(리뷰 반영).** 할당량 검사 없이 24시간 보관하는 경로라 동영상도 파일당 100MB(`CORE_UPLOAD_MAX_BYTES`).
   1GB 동영상은 드라이브 경로만.
10. **웹 동영상 판정은 공유 표 하나.** `lib/mimeFromFilename` 의 확장자 표에 동영상 확장자를 더하고(서버 표와 같은 목록, m4v 는 양쪽 모두 video/mp4),
    첨부 형식 규칙 `attachmentMime` 을 그리로 옮겨 `isVideoFile` 로 사전 검사·썸네일 아이콘이 함께 쓴다. 썸네일은 이름도 받아 octet-stream 으로 저장된
    옛 동영상도 동영상 아이콘이 된다.

## 경로 점검(timeouts·임시 디스크)

- **ingress-nginx**: 기본 `proxy-request-buffering on` 이면 900MB 본문을 컨트롤러 파드 `/tmp/nginx/client-body` 에 다 쓴 뒤 넘긴다(컨트롤러는 이
  차트 밖, 디스크 여유 확인 불가). → 이 Ingress 에 `proxy-request-buffering: "off"` 로 흘려 보낸다. `client_body_timeout`(기본 60s)·
  `proxy-send-timeout`(기본 60s)은 **두 번의 읽기/쓰기 사이** 시간이라 업로드가 계속 흐르면 끊지 않는다. 다만 `proxy-read-timeout`(기본 60s)은 본문을 다
  보낸 뒤 API 가 임시 파일을 NFS 로 복사·DB 기록하는 동안 응답을 기다리는 시간이라, 느린 NFS 에서 900MB 가 60s 를 넘기면 저장은 됐는데 504 가 나고 재시도로
  같은 이름 새 버전이 생길 수 있다. → send/read 를 600s 로(`ingress.proxyTimeoutSeconds`).
- **다른 Ingress 대기 시간**: `collab-ingress.yaml` 은 따로의 Ingress 로 `/collab` 에 3600s 를 이미 둔다(그대로). 메인 Ingress(웹·admin·mcp)는 지금까지 기본값 60s 였으므로 600s 는 늘리기만 한다.
- **web nginx**: 기본 요청 버퍼링이면 `client_body_temp` 에 900MB 사본을 또 쓴다(파드에 ephemeral-storage limit·emptyDir 없음 → 노드 디스크 쓰기).
  → `/api/` 에 `proxy_request_buffering off`. `proxy_read_timeout 86400s` 는 이미 있다. admin 도 같은 값으로 맞춘다.
- **API(Spring)**: `file-size-threshold` 기본 0 → 멀티파트 본문은 `java.io.tmpdir`(컨테이너 쓰기 계층)에 임시 파일로 쓰이고 요청이 끝나면 지워진다.
  api 파드에도 ephemeral-storage limit·emptyDir·readOnlyRootFilesystem 이 없어 축출 한도는 노드 디스크 압박뿐이다. 동시 1GB 업로드 수만큼 노드 디스크를
  잠깐 쓴다 — 값은 바꾸지 않고 기록만 한다(노드 디스크 여유는 로컬에서 확인 불가).
- 버퍼링을 끄면 느린 클라이언트 업로드 동안 Tomcat 스레드를 잡는다 — 대용량 업로드 동시성은 낮아 받아들인다.
- 웹 axios `client` 에 전역 timeout 이 없다 — 900MB 업로드가 클라이언트에서 끊기지 않는다.

## Review Focus

- `video/*` 의 이상한 하위 형식·대소문자·매개변수(`Video/MP4; codecs=avc1`) → VIDEO.
- Content-Type 없음 / `application/octet-stream` + `.mp4`·`.MOV` → `video/mp4`·`video/quicktime` → VIDEO. 웹 사전 검사도 같은 판정.
- 경계: 정확히 1GB(1073741824B) 통과, 1GB+1 거절(서버·웹 모두).
- DATA(csv) 직접 업로드 100MB+1 거절, 업로드 링크 `maxBytes` — csv·pdf 100MB, 미분류 25MB, mp4 1GB.
- 메일 첨부 저장 — 동영상이어도 100MB 상한.
- 멀티파트 `max-request-size`(1100MB) ≥ ingress·nginx 상한(1100m) 일치.
