import { TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'

import { wikiApi } from '../../api/wiki'
import { extractApiError } from '../../lib/api-error'

/** 클라이언트에서 미리 거르는 이미지 MIME. 최종 판정은 서버(매직바이트)가 한다. */
const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_BYTES = 10 * 1024 * 1024
const INVALID_MSG = 'PNG·JPEG·GIF·WebP 이미지만 10MB 까지 올릴 수 있습니다.'
const DATA_URI_REJECTED_MSG = '붙여넣은 이미지를 사용할 수 없습니다.'

function isValidImageFile(file: File): boolean {
  return ACCEPTED.has(file.type) && file.size <= MAX_BYTES
}

/**
 * 클립보드에 PM 이 삽입할 텍스트가 있는지 판정한다. PM 자신의 `getText`(prosemirror-view
 * dist:3675-3681)와 같은 폴백 순서를 따른다 — `text/plain` → `Text`(구 IE) → `text/uri-list`.
 * `text/plain` 만 보면, PM 은 `Text`/`text/uri-list` 로만 채워진 텍스트를 붙여넣을 텐데 우리는
 * "잃을 게 없다"고 오판해 이미지-only 분기(preventDefault+true)로 새 버릴 수 있다 — Blocker 의
 * 더 좁은 재발 형태다.
 */
function clipboardHasText(data: DataTransfer): boolean {
  return (
    data.getData('text/plain') !== '' ||
    data.getData('Text') !== '' ||
    data.getData('text/uri-list') !== ''
  )
}

/** `text/html` 에 포함된 `data:image/...` src 들을 File 로 변환한다(엑셀 등에서 복사된 인라인 이미지). */
async function extractDataUriFiles(html: string): Promise<File[]> {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const srcs = Array.from(doc.querySelectorAll('img[src^="data:image/"]')).map(
    (img) => (img as HTMLImageElement).src,
  )
  const files: File[] = []
  for (const src of srcs) {
    try {
      const blob = await (await fetch(src)).blob()
      files.push(new File([blob], 'pasted.png', { type: blob.type }))
    } catch {
      // 개별 data URI 디코딩 실패는 건너뛴다 — 나머지 이미지는 계속 처리.
    }
  }
  return files
}

let placeholderCounter = 0

/**
 * 노트 본문 이미지 업로드 — 붙여넣기/드래그드롭 공용.
 *
 * <p>업로드 중에는 자리표시자 텍스트를 넣고, 완료되면 그 자리를 실제 이미지 노드로 바꾼다.
 * 위치는 좌표가 아니라 문서 변화에 따라간 자리표시자 텍스트를 다시 찾아 계산한다 —
 * 업로드 중 사용자가 계속 타이핑하면 원래 좌표가 밀리기 때문이다.
 *
 * @param canEditRef VIEWER 는 서버가 403 으로 거부하지만, 그 전에 클라이언트에서 조용히 막아
 *   "업로드에 실패했습니다" 같은 오해의 소지 있는 에러를 보이지 않게 한다(UX 전용 — 서버가
 *   여전히 최종 권한 판정을 한다).
 * @returns `handlePaste`/`handleDrop` — ProseMirror EditorProps 로 그대로 전달. `uploadFilesAtCursor`
 *   — 붙여넣기/드롭이 아닌 다른 진입점(슬래시 메뉴 파일 선택 등)이 현재 커서 위치에 업로드할 때 쓰는
 *   직접 API. 세 함수 모두 같은 유효성 검사·자리표시자·canEdit 게이트를 공유한다.
 */
export function useWikiImageUpload(pageId: number, canEditRef: { current: boolean }) {
  // 훅 반환 핸들러는 useEditor 의존성 배열([page.id])에 들어가지 않으므로 stale closure 가
  // 생길 수 있다 — pageId 는 항상 ref 로 최신값을 읽는다.
  const pageIdRef = useRef(pageId)
  useEffect(() => {
    pageIdRef.current = pageId
  })

  // 자리표시자 텍스트를 넣고, 업로드가 끝나면 문서에서 그 텍스트를 다시 찾아 image 노드로 교체.
  // 좌표를 기억하지 않는 이유는 위 JSDoc 참조 — autosave debounce(800ms) 동안 사용자가 계속
  // 타이핑하면 기억해둔 좌표가 밀려 엉뚱한 위치를 교체하게 된다.
  const uploadOne = useCallback(async (view: EditorView, file: File) => {
    const placeholder = `⏳ 이미지 업로드 중… #${++placeholderCounter}`
    const insertTr = view.state.tr.insertText(placeholder, view.state.selection.from)
    // 자리표시자는 사용자 콘텐츠가 아니다 — WikiEditor.tsx 의 자동저장 update 핸들러가 이 메타를
    // 보고 저장을 건너뛴다(wikiMentionHydrate 와 동일 패턴). 성공/실패 시의 교체·삭제 트랜잭션은
    // 표시하지 않는다 — 그건 실제 콘텐츠 변화이므로 정상적으로 자동저장돼야 한다.
    // (잔여 위험: 업로드 중 사용자가 추가로 타이핑하면 그 트랜잭션은 표시되지 않은 채 저장되고,
    //  그 시점 문서에 자리표시자 텍스트가 아직 있다면 함께 저장된다. 심지어 붙여넣기 *직전*에
    //  이미 타이핑해 scheduleSave 타이머가 걸려 있었다면(단일 debounce 타이머라 자리표시자 삽입이
    //  그 타이머를 리셋하지 않는다) 붙여넣은 뒤 아무것도 안 쳐도 ~800ms 후 그 타이머가 발화해
    //  자리표시자가 그대로 저장될 수 있다(N3). 혼합 붙여넣기(텍스트+이미지, Blocker 픽스)는 이
    //  위험을 실질적으로 더 키운다 — PM 이 텍스트를 삽입하는 트랜잭션은 메타 표시가 없는 일반
    //  트랜잭션이라, 순수 이미지 붙여넣기라면 전혀 타이머가 안 걸렸을 자리에 *모든* 혼합
    //  붙여넣기가 이제 800ms 자동저장 타이머를 건다. 업로드가 800ms 를 넘기면 자리표시자를 포함한
    //  본문이 저장된다 — 다음 저장에서 자연히 자가 치유되지만, 그 사이 탭을 닫으면 영구적이다.
    //  데코레이션 위젯으로 자리표시자를 문서 밖에 렌더링하는 것만이 근본 해결책이고 메타-스킵
    //  설계로는 못 고친다 — 지금은 이 잔여 위험을 감수한다.)
    insertTr.setMeta('wikiImageUploadPlaceholder', true)
    view.dispatch(insertTr)

    // 문서에서 자리표시자 텍스트를 다시 찾아 [from, to) 범위를 반환. 못 찾으면 null(사용자가 지움).
    const findPlaceholder = (): { from: number; to: number } | null => {
      let found: { from: number; to: number } | null = null
      view.state.doc.descendants((node, pos) => {
        if (found || !node.isText || !node.text) return true
        const idx = node.text.indexOf(placeholder)
        if (idx === -1) return true
        found = { from: pos + idx, to: pos + idx + placeholder.length }
        return false
      })
      return found
    }

    try {
      const res = await wikiApi.uploadAttachment(pageIdRef.current, file)
      // WikiPageView 는 key={page.id} 로 리마운트된다 — 업로드 중 다른 페이지로 이동하면 이 view 는
      // 파괴된 상태로 남는다. 파괴된 view 에 dispatch 하면 TypeError 가 나서 catch 로 떨어지고,
      // catch 가 다시 dispatch 해 재차 throw 하며 toast 도 못 띄우고 조용히 죽는다.
      if (view.isDestroyed) return
      const range = findPlaceholder()
      if (!range) {
        // 자리표시자를 못 찾음 — 사용자가 지웠을 수도 있지만, 커서가 자리표시자 안에 들어가
        // 한 글자를 치거나 IME 조합이 그 안에서 일어나 텍스트가 "변형"됐을 수도 있다. 후자면
        // 업로드는 이미 서버에서 성공했는데 이미지가 문서에 들어가지 못하고 아무 알림도 없이
        // 사라진다(invariant 1 위반, Fix 2). 의도적으로 지운 경우엔 toast 가 다소 거슬리지만,
        // 업로드된 이미지를 무음으로 잃는 쪽이 훨씬 나쁘다. warning 을 쓰는 이유는 이 경로의
        // 다수가 사용자 스스로의 undo/편집이 원인이라 error 의 빨간 스타일이 "고장났다"는
        // 인상을 과하게 줄 수 있어서다.
        toast.warning('업로드한 이미지를 넣을 위치를 찾지 못했습니다.')
        return
      }
      try {
        const tr = view.state.tr.replaceWith(
          range.from,
          range.to,
          view.state.schema.nodes.image.create({ src: res.data.url, alt: file.name }),
        )
        view.dispatch(tr)
      } catch {
        // 자리표시자 위치가 image 노드를 허용하지 않는 콘텐츠(예: 코드블록)로 바뀐 경우 —
        // 업로드 자체는 성공했으므로 "업로드 실패" 로 보고하면 안 된다(별도 메시지).
        // toast 를 dispatch 보다 먼저 호출한다(N1) — 뒤에 두면 delete dispatch 가 던질 때
        // toast 가 아예 실행되지 않고 예외만 위로 샌다.
        toast.error('여기에는 이미지를 삽입할 수 없습니다.')
        const stale = findPlaceholder()
        if (stale) view.dispatch(view.state.tr.delete(stale.from, stale.to))
      }
    } catch (err) {
      if (view.isDestroyed) return
      // toast 를 dispatch 보다 먼저 호출한다(N1) — 같은 이유. view 가 살아있는데 delete dispatch
      // 자체가 던지면(예: range 가 그새 무효화) 순서가 반대였을 경우 실패 toast 가 통째로 사라진다.
      // 서버가 보낸 구체적 사유(409 페이지당 첨부 상한, 400 매직바이트 판정 거부 등)가 있으면
      // 그대로 보여준다 — 전부 뭉뚱그리면 사용자가 왜 실패했는지 알 방법이 없다(Minor).
      toast.error(extractApiError(err, '이미지 업로드에 실패했습니다.'))
      const range = findPlaceholder()
      if (range) {
        view.dispatch(view.state.tr.delete(range.from, range.to))
      }
    }
  }, [])

  // 이미 유효성 검사를 통과한 파일들을 순차 업로드한다 — 동시 업로드는 자리표시자 위치 계산을
  // 복잡하게 만들 뿐 아니라, 서버의 페이지당 첨부 개수 상한 검사가 lock-free read-then-write 라
  // 동시 요청 여러 개가 상한을 넘겨 통과할 수 있다(C3).
  const uploadSequential = useCallback(
    async (view: EditorView, files: File[]) => {
      for (const file of files) {
        try {
          await uploadOne(view, file)
        } catch {
          // uploadOne 은 API 실패·삽입 실패를 내부에서 이미 toast 로 알린다 — 여기서 잡는 건
          // 그 처리 자체가 던지는 경우(예: 자리표시자 삽입 dispatch 가 파괴된 view 에서 실패)다.
          // 잡지 않으면 for 루프가 여기서 멈춰 나머지 파일들이 통째로 건너뛰어진다(N1).
        }
      }
    },
    [uploadOne],
  )

  // 좌표가 아니라 문서 위치(pos)를 받아 그 자리로 선택을 옮기고 업로드를 시작하는 공용 진입점.
  // handleDrop(좌표→pos 변환은 호출부가 함)과 슬래시 메뉴의 파일 선택(항상 현재 커서)이 공유한다.
  // 유효성 검사·toast·canEdit 게이트를 한곳에 모아 두 경로가 어긋나지 않게 한다.
  const uploadFilesAt = useCallback(
    (view: EditorView, pos: number, files: File[]): boolean => {
      if (!canEditRef.current) return false // VIEWER — 서버가 403 으로 막지만 조용히 선제 차단(M2).
      const imageFiles = files.filter((f) => f.type.startsWith('image/'))
      if (imageFiles.length === 0) {
        // 파일은 있는데 이미지가 하나도 아님(예: PDF 드롭) — 형식 거부와 같은 메시지로 알린다.
        // 안 그러면 같은 제스처(드롭)인데 "형식이 틀린 이미지"는 toast 가 뜨고 "아예 이미지가
        // 아닌 파일"은 아무 반응이 없어 사용자가 뭐가 잘못됐는지 알 수 없다(finding 3). handlePaste
        // 는 호출 전에 이미 이미지로만 걸러 넘기고 슬래시 메뉴 file input 도 accept 로 걸러져 있어,
        // 이 분기는 사실상 handleDrop 에서만 닿는다.
        if (files.length > 0) toast.error(INVALID_MSG)
        return false
      }
      // 유효성 검사를 먼저 한다 — 업로드할 파일이 하나도 없으면 선택 위치도 옮기지 않는다(I1).
      const valid = imageFiles.filter(isValidImageFile)
      if (valid.length < imageFiles.length) toast.error(INVALID_MSG)
      if (valid.length === 0) return false
      view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))))
      void uploadSequential(view, valid)
      return true
    },
    [canEditRef, uploadSequential],
  )

  // 슬래시 메뉴 '이미지' 항목(#751) 의 file input onChange 전용 진입점 — 항상 현재 커서 위치에
  // 올린다. 이전에는 handleDrop 을 재사용하려고 좌표를 역산해 합성 DragEvent 를 만들었는데,
  // 그러면 이 훅의 handleDrop 내부 가드(유효성 선검사·isDestroyed·canEdit)가 바뀔 때마다
  // 합성 이벤트가 그 변화를 의도치 않게 그대로 상속했다 — 실제 드롭이 아닌 경로를 실제 드롭
  // 처리기에 억지로 태우는 대신, pos 를 직접 받는 별도 진입점을 둔다(C4).
  const uploadFilesAtCursor = useCallback(
    (view: EditorView, files: File[]) => {
      uploadFilesAt(view, view.state.selection.from, files)
    },
    [uploadFilesAt],
  )

  const handlePaste = useCallback(
    (view: EditorView, event: ClipboardEvent): boolean => {
      // VIEWER 선제 차단 — uploadFilesAt 도 같은 게이트를 갖고 있어 원칙적으로 중복이지만(N2),
      // 여기서 조기 반환하면 아래의 DOMParser 파싱·비동기 fetch(data: URI 추출) 작업 자체를
      // 건너뛸 수 있다. handleDrop 은 그런 비용이 없어 uploadFilesAt 게이트 하나로 충분하다.
      if (!canEditRef.current) return false
      const data = event.clipboardData
      if (!data) return false

      // clipboardData.files 와 items 양쪽을 확인하되, files 가 있으면 그것만 쓴다. items 는
      // DataTransferItem.getAsFile() 을 호출할 때마다 새 File 객체를 만들어(lastModified 도
      // 그때 찍힌다) 참조·내용 어느 쪽으로도 files 와 dedup 할 수 없다 — 둘 다 채워지는
      // Chrome 스크린샷 붙여넣기 같은 경우 items 까지 더하면 같은 이미지가 두 번 업로드된다(C1).
      const fileList = Array.from(data.files ?? []).filter((f) => f.type.startsWith('image/'))
      const imageFiles =
        fileList.length > 0
          ? fileList
          : Array.from(data.items ?? [])
              .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
              .map((item) => item.getAsFile())
              .filter((f): f is File => f != null)

      if (imageFiles.length > 0) {
        // 클립보드에 텍스트가 함께 있으면(Excel/Word 에서 셀 범위를 복사하면 렌더링된 image/png 와
        // text/plain·text/html 이 동시에 담긴다) 기본 붙여넣기를 막지 않는다 — 막으면 이미지는
        // 남지만 함께 복사된 텍스트(표 등)가 통째로 사라진다. 이는 아래 data: 분기가 막고 있는
        // 것과 정확히 같은 무음 데이터 손실 클래스라, 두 분기가 같은 규칙(텍스트가 있으면 절대
        // 기본 붙여넣기를 막지 않는다)을 따르도록 통일한다(Blocker).
        if (!clipboardHasText(data)) {
          // 순수 이미지 붙여넣기(예: Chrome 의 "이미지 복사") — 잃을 텍스트가 없으므로
          // uploadFilesAt 이 유효성 검사(I1)·toast·canEdit 게이트를 전담해 바로 업로드한다.
          const started = uploadFilesAt(view, view.state.selection.from, imageFiles)
          if (!started) return false
          event.preventDefault()
          return true
        }
        // 혼합 붙여넣기 — 텍스트는 기본 붙여넣기로 살리고(return false), 이미지는 비동기로 별도
        // 업로드한다. 여기서 "기본 붙여넣기"는 브라우저 네이티브 동작이 아니라 PM 자신의 doPaste
        // 다: handlePaste 가 false 를 반환하면 PM 은 같은 동기 호출 스택 안에서 자신의 붙여넣기
        // 트랜잭션을 동기적으로 dispatch 한 뒤에야 이벤트 핸들러 체인이 끝난다(prosemirror-view
        // @1.41.8 dist:3662-3674). 우리 마이크로태스크(.then)는 그 모든 동기 처리가 끝나고
        // 콜스택이 완전히 비운 뒤에야 실행되므로, 실행 시점엔 텍스트가 이미 문서에 들어가 있어
        // view.state.selection.from 이 삽입 이후의 올바른 위치를 가리킨다 — 만약 여기서 브라우저
        // 네이티브 붙여넣기를 기다리는 것이었다면 마이크로태스크가 그보다 먼저 드레인돼 자리표시자가
        // 텍스트보다 먼저 삽입되는 잘못된 순서가 됐을 것이다.
        void Promise.resolve().then(() => {
          uploadFilesAt(view, view.state.selection.from, imageFiles)
        })
        return false
      }

      // 이미지 파일이 없으면 text/html 안의 data: 이미지를 확인한다(#750 이 data: src 를 버리는 케이스).
      // 문자열 사전 검사(`includes('src="data:image/')`)는 따옴표에 민감해 홑따옴표 HTML 을 놓치므로
      // 쓰지 않는다(I2) — html 이 있으면 항상 DOMParser 로 파싱해 실제 img 태그를 찾는다.
      const html = data.getData('text/html')
      if (html) {
        // 비동기로 추출·업로드하되, 반드시 false 를 반환해 기본 붙여넣기(텍스트 포함)를 살린다.
        // true 를 반환하면 이미지는 살지만 함께 복사된 문단 텍스트가 통째로 사라진다 —
        // #750 과 같은 실패 클래스의 무음 데이터 손실이다.
        void extractDataUriFiles(html).then((files) => {
          if (files.length === 0) return // data: img 태그 자체가 없었음 — 조용히 통과.
          // 여기서 한 번만 필터링·toast 한다 — uploadSequential 은 이미 유효한 파일만 받으므로
          // 중복 toast(M1)가 나지 않는다.
          const valid = files.filter(isValidImageFile)
          if (valid.length === 0) {
            toast.error(DATA_URI_REJECTED_MSG)
            return
          }
          // valid 는 이미 걸러졌으므로 uploadFilesAt 내부의 재검증은 통과만 하고 toast 없이
          // 업로드를 시작한다(M1 — 여기서 딱 한 번만 toast 한다).
          uploadFilesAt(view, view.state.selection.from, valid)
        })
      }
      return false
    },
    [canEditRef, uploadFilesAt],
  )

  const handleDrop = useCallback(
    (view: EditorView, event: DragEvent, _slice: unknown, moved: boolean): boolean => {
      if (moved) return false // 에디터 내부 이동(텍스트/노드 드래그) — 기본 동작 유지.
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length === 0) return false
      // 파일이 있으면 업로드가 실제로 시작됐는지와 무관하게 항상 preventDefault+true 를 반환한다.
      // ProseMirror 는 dragover 는 막아주지만, drop 에서 false 를 반환하고 슬라이스에 텍스트가
      // 없으면 자신도 preventDefault 를 하지 않는다 — 그러면 브라우저 기본 동작(드롭된 파일로
      // 탭을 새로 여는 파일 내비게이션)이 실행돼 미저장 변경분까지 날아간다(Fix 3). 거부된
      // 파일(무효 형식·크기, VIEWER)이라도 최소한 페이지 이탈은 막아야 한다 — uploadFilesAt 이
      // 필요한 toast 는 알아서 띄운다.
      const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
      const pos = coords?.pos ?? view.state.selection.from
      uploadFilesAt(view, pos, files)
      event.preventDefault()
      return true
    },
    [uploadFilesAt],
  )

  return useMemo(
    () => ({ handlePaste, handleDrop, uploadFilesAtCursor }),
    [handlePaste, handleDrop, uploadFilesAtCursor],
  )
}
