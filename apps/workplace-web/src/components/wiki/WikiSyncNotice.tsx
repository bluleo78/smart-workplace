import { Ban, CloudOff, CloudUpload, LogIn, RotateCw, Trash2 } from 'lucide-react'
import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

import { pageGutterClass, pageReadingWidthClass } from '@/components/layout/Page'
import { cn } from '@/lib/utils'

import { isAccessLost, reloadPage, type SyncStatus } from '../../lib/collab/collabStatus'

/**
 * 동기화 안내 띠(WP-287 디자이너 리뷰) — 미전송(unsent)·접근 불가(forbidden)·삭제됨(deleted)·로그인 필요(signed-out)·새 버전(outdated)일 때 본문 스크롤 영역 맨 위에 붙는다.
 *
 * - sticky 라 긴 문서 아래쪽에서 입력 중이어도 화면에서 사라지지 않는다(예전엔 제목 위 일반 흐름이라 스크롤로 밀려 안 보였다).
 * - 띠가 나타나거나 사라질 때 본문이 밀려 커서 줄이 튀지 않게 그만큼 scrollTop 을 보정한다 — 결과적으로 띠는
 *   본문 위에 겹쳐 뜨고, 맨 위로 스크롤하면 제목 위(시안 ④ 위치)에 그대로 놓인다.
 * - 글자는 본문색(text-foreground)·아이콘만 빨강 — 연한 빨강 바탕 위 빨강 글자는 라이트에서 대비 3.15:1 로 AA 미달이었다.
 * - 바깥 래퍼는 항상 마운트한다(안내 없으면 높이 0) — 높이 변화를 ResizeObserver 로 지켜보며 보정하기 위해서.
 * - 예외: 삭제됨·접근 불가 띠가 맨 위(scrollTop≈0)에서 나타나면 보정하지 않고 본문을 밀어 낸다(WP-296) — 보정하면 띠가 제목을
 *   덮어 무엇이 지워졌는지 안 보인다. 편집이 막힌 종료 상태라 커서 줄이 튈 걱정도 없다. 중간까지 내려 읽던 중이면 그대로 보정한다.
 */
export function WikiSyncNotice({
  status,
  listPath,
  scrollRef,
}: {
  status: SyncStatus
  /** 종료 안내(삭제됨·접근 불가)의 "노트 목록으로" 목적지 — wikiListPath 가 정한다. */
  listPath: string
  scrollRef: RefObject<HTMLDivElement | null>
}) {
  const stripRef = useRef<HTMLDivElement>(null)
  useKeepContentOnStripResize(scrollRef, stripRef, isAccessLost(status))

  return (
    <div ref={stripRef} className="sticky top-0 z-10">
      {status === 'forbidden' && (
        <NoticeBox>
          <Ban className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          {/* 종료 상태 — 접근 권한을 잃었거나, 삭제 여부를 모르는 거절(접속 시점에 이미 지워진 노트 등)이다.
              편집 중 삭제는 서버가 삭제 코드로 따로 알려 아래 deleted 로 간다. 재연결하지 않으므로 스피너 없이 알리고,
              삭제됨과 같은 모양으로 나갈 길(노트 목록)을 준다 — 경고(alert)는 문구만, 링크는 같은 줄에 이어 둔다. */}
          <span data-testid="wiki-forbidden-notice">
            <span role="alert">삭제되었거나 접근 권한이 없습니다</span>{' '}
            <Link to={listPath} className="py-1 font-semibold underline underline-offset-2" data-testid="wiki-forbidden-to-list">
              노트 목록으로
            </Link>
          </span>
        </NoticeBox>
      )}
      {status === 'deleted' && (
        <NoticeBox>
          <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          {/* 종료 상태(WP-296) — 다른 사람이 이 노트를 지웠다. 화면의 내용은 그대로 둬 아직 옮기지 못한 글을 복사할 수 있게 하고,
              나갈 길(노트 목록)을 준다. 재연결하지 않으므로 스피너 없이 알린다.
              경고(alert)는 문구만 — 링크까지 넣으면 낭독이 "링크, 노트 목록으로"까지 이어진다. 링크는 같은 줄에 이어 둔다.
              링크의 py-1 — 글줄(inline) 요소라 줄 높이·띠 높이는 그대로 두고 터치 영역만 24px 이상으로 넓힌다(10-accessibility). */}
          <span data-testid="wiki-deleted-notice">
            <span role="alert">이 노트가 삭제되었습니다. 화면의 내용은 이 화면을 닫기 전까지 볼 수 있어요.</span>{' '}
            <Link to={listPath} className="py-1 font-semibold underline underline-offset-2" data-testid="wiki-deleted-to-list">
              노트 목록으로
            </Link>
          </span>
        </NoticeBox>
      )}
      {status === 'signed-out' && (
        <NoticeBox>
          <LogIn className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          {/* 종료 상태 — 로그인이 풀려(refresh 거절) 재연결하지 않는다. 앱의 다른 곳처럼 다시 로그인하도록 안내한다. */}
          <span role="alert" data-testid="wiki-signed-out-notice">
            로그인이 필요합니다.{' '}
            <a href="/login" className="py-1 font-semibold underline underline-offset-2">
              다시 로그인
            </a>
          </span>
        </NoticeBox>
      )}
      {status === 'outdated' && (
        <NoticeBox>
          <RotateCw className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          {/* 종료 상태(WP-313) — 동기화 서버가 새 스키마로 배포돼 이 탭으론 붙지 않는다. 칩 title 은 모바일에서 안 보이므로
              미전송 입력이 저장되지 않는다는 사실을 여기서도 알린다. */}
          <span role="alert" data-testid="wiki-outdated-notice">
            새 버전이 배포되었어요. 아직 저장되지 않은 입력은 저장되지 않습니다.{' '}
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={reloadPage}
              data-testid="wiki-outdated-reload"
            >
              새로고침
            </button>
          </span>
        </NoticeBox>
      )}
      {status === 'unsent' && (
        <NoticeBox>
          <CloudUpload className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          {/* 오프라인 중 입력이 있다 — 탭을 닫으면 잃으므로(기기 저장 없음, Q8) 알린다. 강조 문구는 시안 ④ 그대로. */}
          <span role="status" data-testid="wiki-unsent-notice">
            오프라인이에요. 입력한 내용은 <strong className="font-semibold">이 화면을 닫지 않는 동안</strong> 보관되고,
            연결되면 자동으로 합쳐집니다.
          </span>
        </NoticeBox>
      )}
    </div>
  )
}

/** 안내 박스 모양 — 옅은 빨강 바탕·본문색 글자·아이콘만 상태색. 띠(NoticeBox)와 본문 자리 안내가 같이 쓴다. */
const NOTICE_CLASS =
  'flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground'

/** 띠 한 줄 — 불투명 배경(bg-background) 위에 옅은 빨강 박스를 얹어, 겹쳐 뜬 본문이 비치지 않게 한다. 본문 칼럼과 가로 정렬. */
function NoticeBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b bg-background">
      {/* 본문 칼럼(Page reading 폭 — 왼쪽 정렬·같은 페이지 여백)과 같은 축. */}
      <div className={cn(pageGutterClass, pageReadingWidthClass, 'py-2')}>
        <div className={NOTICE_CLASS}>{children}</div>
      </div>
    </div>
  )
}

/**
 * 첫 동기화를 끝내 못 한 본문 자리 안내 — skeleton 이 설명 없이 영영 남지 않게 대신 놓인다(deriveBodyState 'unreachable').
 * 재연결은 세션이 계속 시도하고, 붙으면 이 자리에 본문이 나온다. 본문 칼럼 안에 놓이므로 띠와 달리 바깥 여백이 없다.
 */
export function WikiSyncUnreachable() {
  return (
    <div className={NOTICE_CLASS}>
      <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      <span role="status" data-testid="wiki-sync-unreachable">
        동기화 서버에 연결하지 못했어요. 연결되면 자동으로 불러옵니다
      </span>
    </div>
  )
}

/**
 * 스크롤 영역 맨 앞의 띠 높이가 바뀌면(등장·사라짐·줄바꿈·종류 전환) 본문이 화면에서 밀린 만큼 scrollTop 을 되돌려 제자리에 둔다.
 *
 * 기준은 띠 바로 뒤 본문 칼럼의 화면상 top — 스크롤 영역 안에서 그 위에 있는 건 띠뿐이라, 스크롤 없이 바뀌었다면 띠 때문이다.
 * 브라우저 스크롤 앵커링이 이미 되돌렸으면 밀린 양이 0 이라 이중 보정이 없다(Chromium 은 앵커링, iOS Safari 는 미지원이라 여기서 보정).
 * 스크롤러의 overflow-anchor 는 건드리지 않는다(원격 편집이 화면 위쪽에 들어올 때 앵커링이 필요하다).
 * 짧은 문서처럼 더 내릴 여유가 없으면 브라우저가 scrollTop 을 잘라 일부만 보정된다.
 */
function useKeepContentOnStripResize(
  scrollRef: RefObject<HTMLDivElement | null>,
  stripRef: RefObject<HTMLDivElement | null>,
  pushAtTop: boolean,
) {
  // 맨 위에서는 보정하지 않고 밀어 낼지(삭제됨·접근 불가 띠) — 관찰자를 다시 걸지 않도록 ref 로 최신 값만 읽는다.
  // 레이아웃 effect 로 커밋 직후 동기 갱신한다 — 수동 effect 는 띠 높이 변화의 ResizeObserver 콜백보다 늦을 수 있다.
  const pushAtTopRef = useRef(pushAtTop)
  useLayoutEffect(() => {
    pushAtTopRef.current = pushAtTop
  }, [pushAtTop])
  useEffect(() => {
    const scroller = scrollRef.current
    const strip = stripRef.current
    if (!scroller || !strip) return
    const contentTop = () => (strip.nextElementSibling as HTMLElement | null)?.getBoundingClientRect().top ?? 0
    let lastTop = contentTop()
    // 띠가 바뀌기 직전의 스크롤 위치 — 맨 위(≈0)였는지로 밀어 낼지 판단한다.
    let lastScrollTop = scroller.scrollTop
    // 사용자가 스크롤하면 본문 위치가 바뀌는 게 정상이다 — 기준값만 갱신한다.
    const onScroll = () => {
      lastTop = contentTop()
      lastScrollTop = scroller.scrollTop
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    // ResizeObserver 콜백은 레이아웃 뒤·페인트 전에 돈다 → 밀린 본문이 한 프레임도 그려지지 않는다.
    const ro = new ResizeObserver(() => {
      const shift = contentTop() - lastTop
      const atTop = lastScrollTop <= 1
      if (shift !== 0 && !(pushAtTopRef.current && atTop)) scroller.scrollTop += shift
      lastTop = contentTop()
      lastScrollTop = scroller.scrollTop
    })
    ro.observe(strip)
    return () => {
      ro.disconnect()
      scroller.removeEventListener('scroll', onScroll)
    }
  }, [scrollRef, stripRef])
}
