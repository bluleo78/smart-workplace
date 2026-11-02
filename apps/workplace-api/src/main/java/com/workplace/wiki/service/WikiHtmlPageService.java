package com.workplace.wiki.service;

import com.workplace.wiki.dto.CreateHtmlPageRequest;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.RevisionReason;
import com.workplace.wiki.dto.SaveHtmlPageRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiPageKind;
import com.workplace.wiki.exception.WikiConflictException;
import com.workplace.wiki.exception.WikiHtmlTooLargeException;
import com.workplace.wiki.exception.WikiPageKindMismatchException;
import com.workplace.wiki.exception.WikiPageNotFoundException;
import com.workplace.wiki.repository.WikiPageDocRepository.RevisionBasis;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiRevisionRepository;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 「HTML 문서」 페이지(WP-1307) — 원본 HTML 을 그대로 보관하는 노트 페이지 종류의 만들기·저장·되돌리기.
 *
 * <p>노트와 달리 동기화 서버(Yjs)를 거치지 않고 DB 에 바로 낙관적 저장한다(편집 → 저장). 원본은 {@code html_source} 에, 원본에서 뽑은 본문
 * 글자({@link WikiHtmlText})는 {@code body} 에 둔다 — 검색 색인·AI 요약·미리보기처럼 body 를 읽는 기존 경로가 그대로 글자를 보게. 저장할
 * 때마다 직전 판을 버전 기록에 남긴다(노트의 시간 규칙과 다르다 — 저장이 곧 한 판).
 */
@Service
@RequiredArgsConstructor
public class WikiHtmlPageService {
  /** 원본 HTML 크기 상한 — 지금 「HTML 파일 넣기」와 같은 5MB(UTF-8 바이트). */
  public static final int HTML_MAX_BYTES = 5 * 1024 * 1024;

  private final WikiPageService pageService;
  private final WikiPageRepository pages;
  private final WikiRevisionRepository revisions;
  private final WikiBodyEffects bodyEffects;
  // WP-1308: 원본 쓰기(write)가 편집 잠금을 보고(다른 세션이 편집 중이면 409), 편집 「저장」이면 그 잠금·임시 저장본을 정리한다.
  private final WikiHtmlLockService locks;

  /** HTML 문서 페이지를 만들고 첫 원본을 넣는다. EDITOR 이상 — 권한·부모 검사는 노트 만들기와 같다. 첫 원본은 판을 남기지 않는다(직전 판이 없다). */
  @Transactional
  public WikiPageDetail create(long callerId, long spaceId, CreateHtmlPageRequest req) {
    requireWithinLimit(req.html());
    WikiPageDetail created =
        pageService.create(
            callerId,
            spaceId,
            new CreatePageRequest(req.parentId(), req.title()),
            WikiPageKind.HTML);
    return write(created, created.title(), req.html(), callerId, created.version(), null);
  }

  /**
   * 원본 저장(소스 저장·다시 올리기·MCP 바꾸기). EDITOR 이상, HTML 문서만, version 이 다르면 409. 원본·제목이 그대로면 저장하지
   * 않는다(판·version 을 늘리지 않게).
   *
   * <p>WP-1308: 편집 잠금 판정·정리는 원본을 쓰는 한 곳({@link #write})이 한다 — 다른 편집 세션이 편집 중이면 409({@link
   * com.workplace.wiki.exception.WikiHtmlLockedException}), 편집 「저장」(req.lockToken)이면 저장과 함께 그 잠금을
   * 풀고 임시 저장본을 지운다. 바뀐 것이 없어도 편집 「저장」은 편집을 끝낸다(잠금을 푼다).
   *
   * @param ai MCP·AI 비서 경로면 true — 직전 판을 AI 사유로 남기고 요청자를 ✦ 귀속한다
   */
  @Transactional
  public WikiPageDetail save(long callerId, long pageId, SaveHtmlPageRequest req, boolean ai) {
    requireWithinLimit(req.html());
    WikiPageDetail current = requireHtml(pageService.loadForEdit(callerId, pageId));
    String title = req.title() != null ? req.title() : current.title();
    if (req.html().equals(current.html()) && title.equals(current.title())) {
      locks.afterWrite(current.spaceId(), pageId, callerId, req.lockToken());
      return current;
    }
    // 낡은 version 이면 판을 남기기 전에 거절한다(쓸모없는 판을 만들지 않게). 이유는 write 와 같은 순서로 가린다 — 다른 세션이 편집 중이면
    // version 이 달라도 「편집 중」 409 를 먼저 알린다(무엇을 기다려야 하는지가 더 쓸모 있다). 맞으면 UPDATE 가 잠금·version 을 다시 본다.
    if (current.version() != req.version()) {
      locks.throwIfLockedByOther(pageId, req.lockToken());
      throw new WikiConflictException(pageId);
    }
    snapshot(current, ai ? RevisionReason.AI : RevisionReason.SESSION, ai ? callerId : null);
    return write(current, title, req.html(), callerId, current.version(), req.lockToken());
  }

  /**
   * 판 되돌리기(트랜잭션 안 — {@link WikiRevisionService#restore} 가 HTML 문서일 때 부른다). 그 판의 원본으로 저장하고 직전 판을
   * RESTORE 사유로 남긴다. 원본이 이미 같으면 저장하지 않는다. 편집 세션이 없는 쓰기라 누가 편집 중이면 409(WP-1308 — {@link #write}).
   */
  WikiPageDetail restoreInTx(WikiPageDetail current, String html, long callerId) {
    if (html.equals(current.html())) {
      return current;
    }
    snapshot(current, RevisionReason.RESTORE, null);
    return write(current, current.title(), html, callerId, current.version(), null);
  }

  /** 이 페이지가 HTML 문서인지 — 아니면 409(노트에 원본 HTML 을 저장하지 않는다). */
  static WikiPageDetail requireHtml(WikiPageDetail page) {
    if (page.kind() != WikiPageKind.HTML) {
      throw new WikiPageKindMismatchException("HTML 문서가 아닌 노트에는 원본 HTML 을 저장할 수 없습니다");
    }
    return page;
  }

  /** 원본 크기 상한(UTF-8 바이트) — 넘으면 413. */
  static void requireWithinLimit(String html) {
    // 글자 수가 상한의 1/4 이하면 UTF-8 로 4바이트씩이어도 넘지 않으므로 인코딩하지 않는다.
    if (html.length() > HTML_MAX_BYTES / 4
        && html.getBytes(StandardCharsets.UTF_8).length > HTML_MAX_BYTES) {
      throw new WikiHtmlTooLargeException();
    }
  }

  /** 직전 판(지금 원본)을 버전 기록에 남긴다. 원본이 비어 있으면(빈 문서·만든 직후) 남기지 않는다. */
  private void snapshot(WikiPageDetail current, RevisionReason reason, Long aiActorId) {
    if (current.html() == null || current.html().isBlank()) {
      return;
    }
    revisions.snapshot(
        current,
        reason,
        RevisionBasis.editorsOf(current.updatedBy()),
        aiActorId,
        current.updatedAt());
  }

  /**
   * 원본·뽑은 글자를 낙관적으로 저장하고 후처리(백링크 교체·SSE)를 한 뒤 새 상세를 돌려준다. HTML 원본을 바꾸는 모든 경로(만들기·저장·다시 올리기·MCP/AI·
   * 되돌리기)가 여기를 지난다 — 편집 잠금 판정과 저장 뒤 정리를 여기 한 곳에 둬 경로마다 다르게 굴지 않게(WP-1308).
   *
   * <p>잠금 판정은 UPDATE 의 WHERE 에 넣어 쓰기와 한 문장으로 한다(lockToken 과 다른 세션의 살아 있는 잠금이 없을 때만 쓴다). 0 행이면 잠금
   * 때문인지 먼저 보고(409 HTML_LOCKED), 아니면 version 충돌(409)이다.
   *
   * @param expectedVersion 낙관적 저장 기준 version
   * @param lockToken 편집 「저장」의 편집 세션 표지 — 없으면(null) 누구든 편집 중일 때 막힌다
   */
  private WikiPageDetail write(
      WikiPageDetail current,
      String title,
      String html,
      long callerId,
      int expectedVersion,
      UUID lockToken) {
    long pageId = current.id();
    String text = WikiHtmlText.extract(html);
    int affected =
        pages.saveHtmlIfVersion(
            pageId, title, html, text, expectedVersion, callerId, lockToken, locks.liveCutoff());
    if (affected == 0) {
      locks.throwIfLockedByOther(pageId, lockToken);
      throw new WikiConflictException(pageId);
    }
    locks.afterWrite(current.spaceId(), pageId, callerId, lockToken);
    bodyEffects.afterBodySaved(current.spaceId(), pageId, title, text, callerId);
    return pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
  }
}
