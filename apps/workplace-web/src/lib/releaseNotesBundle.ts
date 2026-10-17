// 빌드에 번들된 릴리스 노트를 읽는다. 순수 로직(releaseNotes.ts)과 분리해 둔 이유:
// import.meta.glob 과 `@release-notes` 별칭은 Vite 변환 안에서만 풀리므로, 이 모듈을 import 하지 않아야
// 순수 함수 단위 테스트가 별칭·파일 없이 돌아간다(WP-439).
// 별칭은 운영/로컬 빌드에서 저장소 루트 releases/, E2E_RELEASE_NOTES_DIR 가 지정된 E2E 서버에서 e2e/fixtures/releases 를 가리킨다(vite.config.ts).
import { parseReleaseNote, type ReleaseNote } from './releaseNotes'

/** releases/*.md 를 빌드 시점에 원문으로 포함한다(eager) — 런타임 네트워크 요청이 없다. */
const rawNotes = import.meta.glob<string>('@release-notes/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** 번들된 노트를 파싱해 돌려준다. semver 가 아닌 파일명(README 등)은 parseReleaseNote 가 null 로 걸러 제외한다. */
export function loadBundledNotes(): ReleaseNote[] {
  return Object.entries(rawNotes)
    .map(([path, raw]) => parseReleaseNote(path.split('/').pop() ?? path, raw))
    .filter((note): note is ReleaseNote => note !== null)
}
