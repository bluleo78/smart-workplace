# WP-1532 드라이브 동영상 바로 재생(서명 재생 URL + Range) — 계획

## 목표
드라이브 미리보기의 영상·오디오를 blob 으로 통째 받지 않고 짧은 수명의 서명 URL 을 `<video>/<audio>` src 에 바로 넣어 Range(206)로 재생한다.

## API
1. `DrivePlaybackTokens`(drive/service) — `ShareViewTokens` 와 같은 HMAC-SHA256·base64url 형식, 키는 JWT 시크릿에서 라벨 `swp-drive-playback-v1` 로 파생. payload `tenantId|userId|driveFileId|coreFileId|exp`. core file.id 가 버전마다 바뀌어 버전 묶음 역할.
2. `POST /api/v1/drive/files/{id}/playback-url`(인증) — `viewableRow`(휴지통·비멤버 404) + video/audio MIME 만 발급(그 밖 409) + 감사 `FILE_PLAYBACK` 1회. 응답 `{url(상대 경로), expiresAt}`.
3. `GET /api/v1/public/drive/playback/{token}`(무인증) — 서명·만료 → 테넌트 활성 → TenantContext → 행(휴지통 제외) 재조회 + 현재 버전 일치 + 발급 사용자 VIEWER 재확인 → `FileSystemResource` 를 `ResponseEntity.ok()` 로(스프링이 206 처리, Content-Length 직접 설정 안 함). 실패는 모두 404.
4. 헤더: inline, nosniff, CSP sandbox, Cache-Control private no-store 계열, Accept-Ranges(스프링).
5. SecurityConfig: GET·HEAD `/api/v1/public/drive/playback/**` 만 permitAll. 속도 제한 필터에 넣지 않는다.

## Web
1. `ViewerItem.playbackUrlPath` — `driveFileItem` 에만(드라이브 링크·공유 링크·첨부는 blob 경로 유지).
2. `useDrivePlaybackUrl`(useQuery, 창 포커스 재조회 끔, staleTime < TTL) → ViewerBody 가 미디어 + 경로가 있으면 blob 받기를 끄고(10MB 확인·% 화면 생략) URL 을 MediaPlayer 로.
3. `fetches=false` 로 보고(모바일 공유는 「공유할 수 없음」, 저장은 /download).
4. 감사 라벨 `FILE_PLAYBACK` → 「파일 재생」.
5. SW: precache·NavigationRoute 만 있어 미디어 하위 요청을 가로채지 않음 — logic.test 로 고정.

## 테스트
- API JUnit `PublicDrivePlaybackControllerIntegrationTest`: 206 Range·헤더, 만료·변조·다른 파일 재사용·권한 없음·휴지통·새 버전 거부, 감사 1회.
- vitest: ViewerBody 스트리밍 경로(진행/확인 화면 없음, src = 서명 URL, 실패 시 오류 화면).
- E2E `@platform`: page.route 가 Range 를 해석해 206 으로 webm 을 내주고, 재생·탐색 시 범위 요청, /content 미요청 확인. 기존 드라이브 미디어 E2E 를 스트리밍 기준으로 갱신.

## 코드 리뷰 반영
- 발급 `@RequireWebSession`(PAT·AI 키 403). access JWT 에 세션·리프레시 패밀리 id 가 없고 토큰 버전 칸도 없어 세션 폐기 묶음은 하지 않음.
- 토큰을 `LabeledTokenCrypto.seal`(라벨 파생 AES-GCM, base64url)로 봉인 — 주소에 내부 id 없음. ShareViewTokens 도 같은 도구의 sign 으로(형식 동일).
- `PublicRateLimitFilter` 에 DRIVE_PLAYBACK(IP + 토큰 해시, 기본 300/분).
- 재생 형식 화이트리스트(API·웹 같은 목록), 저장 MIME 해석 실패·I/O 오류도 404.
- 웹: 쿼리 키에 사용자·워크스페이스·현재 버전, 미디어 오류 때 주소 한 번 재발급.
- PUBLIC_PATH 상수 하나(SecurityConfig·필터·컨트롤러), 서비스 시계 주입 + TTL 경계 테스트.
