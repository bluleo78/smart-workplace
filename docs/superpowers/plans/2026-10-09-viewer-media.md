# 영상·오디오를 통합 뷰어에서 재생한다 (WP-281) — 구현 계획

통합 첨부 뷰어 PR #5(마지막). 스펙: `docs/superpowers/specs/2026-10-07-attachment-viewer-design.md` §1·§2·§4.1·§4.3·§5.1–5.3·§8.1·§8.3.
시안: `.superpowers/brainstorm/64115-1791377246/content/video-audio-conflicts.html`.
WP-278 계획의 R3 — `inScrubZone` 은 WP-281 이 `lockGesture` 입력에 더한다.

## Global Constraints

- 백엔드 변경 없음. 업로드 상한 25MB 라 blob 통째 받기 → `<video>`/`<audio>` 기본 플레이어(스트리밍·Range 는 범위 밖).
- 기존 안전장치 유지: `api/blobContent` 의 PDF 매직 바이트·텍스트 디코딩, `withItemType` 의 SVG 금지. 다운로드 진행률은 axios `onDownloadProgress` 로만 받는다 — raw fetch/ReadableStream 은 Bearer 인터셉터·401 재발급 큐를 우회하므로 쓰지 않는다.
- 영상·오디오가 아닌 형식의 동작·testid 는 그대로(`preview-loading` 스켈레톤 등).
- 판정은 순수 함수(vitest), 컴포넌트는 DOM 맥락만 재서 넘긴다(WP-277/278 패턴).
- 한국어 주석(무엇·왜) 필수. 태스크마다 `git commit --no-verify`, 메시지 끝 `(WP-281)`.

## 판정(Rulings)

- **M1 `routeKey` 는 기존 `KeyContext` 객체를 넓힌다** — 스펙의 `routeKey(key, focusZone, isFullscreen, kind)` 를 위치 인자로 바꾸지 않고 `media`·`inMedia`·`onControl`·`fullscreen`·`fullscreenJustExited` 필드로 받는다(기존 호출·테스트 유지).
- **M2 Esc** — Radix 의 Esc 닫기(`onEscapeKeyDown`)에서 전체화면 중이거나 직전(500ms) `fullscreenchange` 로 해제됐으면 닫지 않고 전체화면만 해제(`routeKey` → `exitFullscreen`). aiAware 의 Esc 처리를 먼저 부른다.
- **M3 ←/→·Space** — 미디어 요소(네이티브 컨트롤은 shadow DOM 이라 대상이 `<video>`/`<audio>` 로 보정됨)에 포커스가 있거나 전체화면이면 ±5초 탐색, 그 외 파일 넘김. Space 는 미디어 형식에서 버튼·링크 등 조작 요소 위가 아니면 재생/정지, 문서 형식이면 null(스크롤). 우리가 처리한 키는 preventDefault 해 네이티브 기본 동작과 겹쳐 두 번 움직이지 않게 한다.
- **M4 자동재생** — 뷰어를 연 순간의 항목(openedKey)만, 그 항목을 한 번도 떠나지 않은 동안만 자동재생(`shouldAutoplay`). 넘겨 온 항목·되돌아온 항목은 정지 상태(위치 기억). `autoplay` 속성 대신 `el.play()` 를 불러 거부(NotAllowedError, iOS)되면 가운데 재생 버튼으로 폴백. StrictMode 이중 마운트에도 같은 답이 나오게 "소비" 방식이 아니라 "떠난 적 있음" 표식으로 판정.
- **M5 위치 기억·정지·해제** — 본문은 항목 key 로 리마운트되므로 넘기면 요소가 사라진다. 언마운트 때 `currentTime` 을 뷰어의 Map ref 에 저장하고 `pause()`→`src` 제거→`load()` 후 object URL 을 해제한다. 돌아오면 다시 받고 `loadedmetadata` 에서 위치 복원(blob 캐시는 하지 않는다 — 다른 형식과 같은 규칙).
- **M6 제스처** — `lockGesture` 에 `inScrubZone` 추가(참이면 어느 축이든 native). 영상은 요소 아래 48px, 오디오는 요소 전체. 탭: 영상 요소 위 탭은 바 토글 없음(네이티브 컨트롤 표시 몫), 오디오 형식은 탭으로 바를 숨기지 않음(`tapTogglesBars`). 무대 touch-action 은 미디어면 `none`(브라우저 핀치 확대 끔 — 스펙 "핀치 끔"). 네이티브 재생 막대 끌기가 살아 있는지는 E2E 로 확인.
- **M7 바 자동 숨김** — 모바일 배치 + 터치에서 영상 재생 시작 3초 뒤 바를 숨긴다. 일시정지·넘김·언마운트 시 타이머 취소, 포커스가 바 안이거나 요약 시트가 열려 있으면 숨기지 않는다(탭 토글과 같은 규칙).
- **M8 배치** — 영상은 하단 액션 바 위 영역(기존 `chromeInset` 여백)에 `object-contain` + `playsinline`. 바가 숨겨져도 여백을 유지한다 — 재생 3초 뒤 바가 사라질 때 영상이 들썩이지 않게(가로 화면에서 조금 작아지는 비용).
- **M9 진행률** — 영상·오디오만 `preview-loading` 안에 `role=progressbar` 와 `%`·받은/전체 크기. 분모 = 응답 Content-Length, 없으면 항목 크기, 둘 다 없으면 % 없이 "받는 중". 정수 %가 바뀔 때만 상태 갱신.
- **M10 재생 불가** — `error` 이벤트 → 기존 미지원 화면(`preview-unsupported`, 다운로드 포함)으로.

## Task 1 — 형식 판정·확장자·아이콘 + vitest

- `previewKind.ts`: `VIDEO`(`video/*`)·`AUDIO`(`audio/*`). `.avi`·`.mkv` 도 VIDEO 로 들어가 재생 실패 시 M10.
- `mimeFromFilename.ts`: mp4·m4v→video/mp4, webm→video/webm, mov→video/quicktime, mp3→audio/mpeg, m4a→audio/mp4, wav→audio/wav, ogg·oga→audio/ogg, aac→audio/aac, flac→audio/flac. 별칭 audio/x-wav→audio/wav, audio/mp3→audio/mpeg, audio/x-m4a→audio/mp4.
- `FileTypeIcon`: VIDEO→FileVideo, AUDIO→FileAudio(기본 FileText 로 떨어지지 않게).
- 테스트: previewKind·mimeFromFilename(각 확장자가 VIDEO/AUDIO 로 판정됨)·별칭.

## Task 2 — 순수 판정 함수 + vitest

- `viewerNav.ts` `routeKey` 확장(M1–M3) — 액션 `playPause`·`seekBack`·`seekForward`·`exitFullscreen`.
- `viewerGestures.ts`: `SCRUB_ZONE_PX=48`, `inScrubZone(y, rect, media)`, `LockInput.inScrubZone?`, `tapTogglesBars({ media, onMediaElement })`, `stageTouchAction` 에 `media` 입력.
- `mediaPlayback.ts`(신규): `shouldAutoplay`, `progressPercent(loaded, total, fallback)`, `MEDIA_SEEK_SECONDS`, `AUTO_HIDE_BARS_MS`, `FULLSCREEN_ESC_GUARD_MS`, `fitMediaSize`(키워서도 맞춤).
- 테스트: 위 함수 경계값.

## Task 3 — 다운로드 진행률

- `fetchBlobByPath(path, { onProgress })` — axios `onDownloadProgress`.
- `usePreviewBlob(item, enabled, { progress })` → `progress: { loaded, total } | null`, 정수 % 변화만 반영.
- `ViewerBody`: 미디어 로딩 화면(`media-progress`, role=progressbar).

## Task 4 — `MediaPlayer` + 뷰어 배선

- `MediaPlayer.tsx`: 영상(`controls playsInline`, 맞춤 크기)·오디오(큰 아이콘·이름·플레이어). 자동재생·폴백 버튼(`media-play-fallback`)·위치 복원/저장·언마운트 정리·`error` → 미지원 화면·재생 상태 보고.
- `ViewerBody`: VIDEO/AUDIO 분기, 미지원 화면 컴포넌트 공용화, 여백 유지(M8).
- `AttachmentViewer`: 미디어 세션(위치 Map·openedKey·떠남 표식·재생 상태) 고정 객체로 전달, 키보드(M3), Esc(M2), 제스처 옵션(media·scrub·tap), 바 자동 숨김(M7), 확대 툴바 숨김 확인.
- `useViewerGestures`: 시작 대상의 미디어 요소·재생 막대 구역 판정.

## Task 5 — 픽스처 + E2E

- 픽스처: ffmpeg 로 작은 webm(VP8+Opus, 10초, 저해상도)·wav·mp3. 재생 불가 = 쓰레기 바이트 `.mov`(실제 HEVC 는 macOS Chromium 이 VideoToolbox 로 재생할 수 있어 쓰지 않는다). 사전에 `canPlayType` 확인.
- `e2e/pages/drive/attachment-viewer-media.spec.ts`(chromium): 직접 연 영상 자동재생, ‹ › 넘김 → 다음 영상 정지·돌아오면 위치 기억·정지, 닫기 → 요소 제거·URL 해제, 진행률 표시, 재생 불가 → 미지원 화면, 확대 툴바 숨김, 키보드(←/→ 넘김 vs 영상 포커스 탐색, Space, Esc 전체화면 가드 — fullscreenElement 흉내), play() 거부 폴백 버튼, 오디오 화면.
- `e2e/pages/mobile/attachment-viewer-media-mobile.spec.ts`(mobile): 영상 탭 = 바 유지·여백 탭 = 바 토글, 재생 막대 구역 가로 끌기 = 넘기지 않음(+ 위 영역 끌기 = 넘김), 오디오 탭 = 바 유지, 재생 3초 뒤 바 자동 숨김, 액션 바 위 배치.

## Review Focus

1. 진행률 추가가 기존 blob 안전장치(PDF·텍스트·withItemType)를 건드리지 않는지, 인증 경로(axios) 유지.
2. 자동재생 판정(openedKey·떠남 표식)이 StrictMode·넘김·되돌아옴에서 맞는지, 거부 폴백.
3. 언마운트 정리 순서(위치 저장 → 정지 → src 제거 → URL 해제)와 메모리 해제.
4. 키 라우팅: Space 가 버튼 활성화를 뺏지 않는지, ←/→ 가 네이티브와 두 번 탐색하지 않는지, Esc 이중 닫기 방지.
5. 터치: 재생 막대 구역 제외·영상 탭 바 유지·touch-action none 에서 네이티브 막대 조작.
