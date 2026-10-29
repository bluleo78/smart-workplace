# 제품 매뉴얼

Gen:iA Works 의 매뉴얼 두 권을 Markdown 원본에서 HTML 을 거쳐 A4 세로 PDF 로 만든다. 화면 그림에는 빌드 때 번호 표식을 얹고, 표식 번호는 본문 절차 번호와 맞물린다.

| 권 | 대상 | 원본 | 산출물 |
| --- | --- | --- | --- |
| 사용자 매뉴얼 | 구성원·테넌트 관리자 (`workplace-web`) | `user/NN-<slug>.md` | `dist/manual/user/genia-works-user-manual.pdf` |
| 운영자 매뉴얼 | 슈퍼어드민 (`workplace-admin`) | `operator/NN-<slug>.md` | `dist/manual/operator/genia-works-operator-manual.pdf` |

매뉴얼은 제품 설명의 기준 문서다. 화면에 없는 기능·문구·AI 결과를 쓰지 않는다. 장을 쓰거나 고치기 전에 집필 규칙 스킬 [`.claude/skills/manual-authoring/SKILL.md`](../../.claude/skills/manual-authoring/SKILL.md) 을 읽는다.

## 명령

저장소 루트에서 실행한다. `<book>` 은 `user` 또는 `operator` 다(생략하면 검사는 두 권 모두, 빌드는 `user`).

| 명령 | 하는 일 |
| --- | --- |
| `pnpm manual:check [<book>]` | 프론트매터(`part` 포함), 장 `routes` 와 앱 라우터 대조(미커버·유령·중복), 이모지, 그림·표식 키 존재. 오류가 있으면 실패 |
| `pnpm manual:prose [<book>]` | 굵게 쓴 문구를 앱 소스의 한국어 화면 문구와 대조(못 찾은 것은 「미확인 굵게」 목록으로만 출력), 알림 상자 표기, 장 번호 앞 0, 강조 미종결, 남은 `TODO(집필)` |
| `pnpm manual:pdf [<book>]` | `dist/manual/<book>/manual.html` 과 PDF 를 만든다(Playwright Chromium 인쇄). 장이 없거나, 못 실은 그림이나 없는 표식 키가 있으면 실패(예전 산출물은 먼저 지운다) |
| `pnpm manual:shots` | 화면을 찍고 표식 좌표를 `shots/<book>/boxes.json` 에 기록한다. 환경변수 `MANUAL_BOOK`(기본 `user`)·`MANUAL_WEB`·`MANUAL_API`·`MANUAL_PASS` — 뒤의 셋은 기본값이 없어 찍을 장면이 있으면 반드시 준다. 일부만 다시 찍기는 `MANUAL_SHOTS_ONLY=id,...`. 실패한 장면의 좌표는 기록하지 않는다 |
| `pnpm test:manual` | 매뉴얼 도구의 단위 시험 |
| `node docs/manual/scripts/seed-operator.mjs` | 운영자 매뉴얼 촬영용 가상 테넌트를 격리 스택에 넣는다. 환경변수 `MANUAL_API`·`MANUAL_PASS`(둘 다 필수, 값은 출력하지 않음). 빈 DB 의 첫 가입자를 슈퍼어드민(`ops@example.com`)으로 만들고, 나머지는 플랫폼 API 로만 넣는다. 다시 돌려도 된다(있는 테넌트·계정은 건너뜀). **운영자 매뉴얼 격리 스택에만 돈다** — `MANUAL_API` 가 `http://localhost:6166` 이 아니면 멈춘다(공유 개발 DB·다른 세션 스택의 첫 가입 자리를 가져가지 않게) |

종료 코드는 네 명령 모두 0 성공, 1 검사·빌드·촬영 실패, 2 사용법 오류(알 수 없는 책 등)다.

## 폴더 구조

```
docs/manual/
  README.md                 이 문서
  user/NN-<slug>.md         사용자 매뉴얼 원본
  operator/NN-<slug>.md     운영자 매뉴얼 원본
  shots/targets.md          촬영 대상 표(그림 id·경로·계정·준비 조작·자르기·표식 키·시드)
  shots/<book>/<id>.png     촬영 원본(커밋)
  shots/<book>/boxes.json   자르기·표식 상자 좌표(원본 px, 커밋)
  styles/manual.css         PDF 스타일(A4 세로)
  scripts/
    build.mjs               HTML → PDF 빌드
    check.mjs               구조 검사
    prose.mjs               산문 검사
    capture.mjs             촬영
    scenes/<book>.mjs       촬영 장면(촬영 대상 표를 구현)
    seed-operator.mjs       운영자 매뉴얼 촬영용 시드(격리 스택, 플랫폼 API)
    import-intro-shots.mjs  소개서 촬영본을 04장 샘플 그림으로 가져오기(샘플 전용, WP-1196 에서 삭제)
    lib/                    공용 모듈(책 설정·명령줄, 장 읽기, 프론트매터, 마크다운 줄·펜스·링크, HTML, 그림, boxes.json, 렌더, 라우터, 화면 문구, 촬영 도구)
dist/manual/<book>/         빌드 산출물(커밋하지 않음)
```

## 그림

그림은 원본을 그대로 두고 빌드 때 잘라 표식을 얹는다.

```markdown
![담당자 목록](shots/user/ai-collaboration-2.png){crop=picker marks=picker,agent}
```

`crop` 은 `boxes.json` 상자들의 합집합으로 자르고, `marks` 는 적은 순서대로 1부터 번호를 얹는다. 화면이 바뀌면 그 그림만 다시 찍으면 된다. 자르기 폭 기준과 촬영 환경은 집필 규칙 스킬에 있다.

## 현재 상태

- 사용자 매뉴얼은 샘플 장 하나(04 AI 와 함께 일하기)만 있다. 그래서 `manual:check user` 는 다른 경로를 모두 `[미커버]` 로 보고한다.
- 04장 그림은 소개서 촬영본(가상 회사 누리커머스)을 빌려 쓴 샘플이다. 매뉴얼 전용 테넌트가 생기면 다시 찍는다.
- 운영자 매뉴얼은 4개 장(소개와 로그인, 테넌트 만들기와 고치기, 테넌트 구성원, 테넌트 정지·활성화와 삭제)이 모두 있다. 그림은 격리 로컬 스택에서 찍었다.

## 운영자 매뉴얼 다시 찍기

운영 슈퍼어드민 화면에는 실제 고객사 이름이 보이므로 **격리 로컬 스택**에서만 찍는다. 포트는 **DB 5446 · API 6166 · 운영자 콘솔 6275** 로 고정한다 — 개발용(5434·6060·6173·6174)과 다른 세션의 격리 스택(5444·6160)을 건드리지 않는다. 시드는 API 가 localhost:6166 일 때만 돈다(`lib/operator-seed.mjs` 의 `OPERATOR_STACK_API_PORT`).

1. 빈 DB 를 띄운다: `docker run -d --name manual-op-db -e POSTGRES_DB=workplace -e POSTGRES_USER=app -e POSTGRES_PASSWORD=app -p 5446:5432 pgvector/pgvector:pg18`
2. API 를 6166 에 띄운다(`apps/workplace-api` 에서 `./gradlew bootJar -x test` 로 만든 jar): `java -jar <jar> --spring.profiles.active=local --server.port=6166 --spring.datasource.url=jdbc:postgresql://localhost:5446/workplace --spring.flyway.url=jdbc:postgresql://localhost:5446/workplace --app.cors.allowed-origins=http://localhost:6275 --workplace.tenant-purge.delay-ms=3600000 --workplace.tenant-purge.initial-delay-ms=3600000` — 영구 삭제 잡의 첫 실행과 주기를 모두 한 시간으로 미뤄야 「영구 삭제 중」 화면이 촬영 동안 남는다(첫 실행 지연을 주지 않으면 잡이 기동 직후 한 번 돈다). 촬영은 API 를 띄운 뒤 한 시간 안에 끝낸다.
3. 운영자 콘솔을 6275 에 띄운다: `apps/workplace-admin` 에서 `DEV_API_PORT=6166 pnpm exec vite --port 6275 --strictPort` (`DEV_API_PORT` 가 개발 프록시 대상 포트다. 없으면 6060 — 사용자 웹과 같은 이름).
4. 시드: `MANUAL_API=http://localhost:6166 MANUAL_PASS=<가상 비밀번호> node docs/manual/scripts/seed-operator.mjs`
5. 촬영: `MANUAL_BOOK=operator MANUAL_WEB=http://localhost:6275 MANUAL_API=http://localhost:6166 MANUAL_PASS=<같은 비밀번호> pnpm manual:shots`

일부만 다시 찍을 때는 `MANUAL_SHOTS_ONLY` 에 그림 id 를 적는다. 한 장면이 여러 그림을 찍으면(영구 삭제 확인 창 → 진행 배너 → 삭제됨 목록: tenant-lifecycle-7·8·6) 그중 하나만 적어도 그 장면 전체가 돈다. 영구 삭제 장면은 돌 때마다 별빛스튜디오 테넌트를 새로 만들어 지우므로 다시 돌려도 된다. 다만 같은 DB 에서 다시 돌리면 앞서 만든 별빛스튜디오가 「영구 삭제 중」으로 삭제됨 목록에 남아 있고 slug 도 `byeolbit-studio-2` 처럼 바뀌므로, 커밋할 그림은 1번부터 깨끗한 DB 로 찍는다. 운영자 책은 뷰포트 900x810 으로 찍는다(`lib/books.mjs` 의 `capture.viewport` — 이유는 그곳 주석).
