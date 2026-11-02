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
    return write(created, created.title(), req.html(), callerId);
  }

  /**
   * 원본 저장(소스 저장·다시 올리기·MCP 바꾸기). EDITOR 이상, HTML 문서만, version 이 다르면 409. 원본·제목이 그대로면 저장하지
   * 않는다(판·version 을 늘리지 않게).
   *
   * @param ai MCP·AI 비서 경로면 true — 직전 판을 AI 사유로 남기고 요청자를 ✦ 귀속한다
   */
  @Transactional
  public WikiPageDetail save(long callerId, long pageId, SaveHtmlPageRequest req, boolean ai) {
    requireWithinLimit(req.html());
    WikiPageDetail current = requireHtml(pageService.loadForEdit(callerId, pageId));
    String title = req.title() != null ? req.title() : current.title();
    if (req.html().equals(current.html()) && title.equals(current.title())) {
      return current;
    }
    if (current.version() != req.version()) {
      throw new WikiConflictException(pageId);
    }
    snapshot(current, ai ? RevisionReason.AI : RevisionReason.SESSION, ai ? callerId : null);
    return write(current, title, req.html(), callerId);
  }

  /**
   * 판 되돌리기(트랜잭션 안 — {@link WikiRevisionService#restore} 가 HTML 문서일 때 부른다). 그 판의 원본으로 저장하고 직전 판을
   * RESTORE 사유로 남긴다. 원본이 이미 같으면 저장하지 않는다.
   */
  WikiPageDetail restoreInTx(WikiPageDetail current, String html, long callerId) {
    if (html.equals(current.html())) {
      return current;
    }
    snapshot(current, RevisionReason.RESTORE, null);
    return write(current, current.title(), html, callerId);
  }

  /** 이 페이지가 HTML 문서인지 — 아니면 409(노트에 원본 HTML 을 저장하지 않는다). */
  static WikiPageDetail requireHtml(WikiPageDetail page) {
    if (page.kind() != WikiPageKind.HTML) {
      throw new WikiPageKindMismatchException("HTML 문서가 아닌 노트에는 원본 HTML 을 저장할 수 없습니다");
    }
    return page;
  }

  /** 원본 크기 상한(UTF-8 바이트) — 넘으면 413. */
  private static void requireWithinLimit(String html) {
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

  /** 원본·뽑은 글자를 낙관적으로 저장하고 후처리(백링크 교체·SSE)를 한 뒤 새 상세를 돌려준다. */
  private WikiPageDetail write(WikiPageDetail current, String title, String html, long callerId) {
    long pageId = current.id();
    String text = WikiHtmlText.extract(html);
    int affected = pages.saveHtmlIfVersion(pageId, title, html, text, current.version(), callerId);
    if (affected == 0) {
      throw new WikiConflictException(pageId);
    }
    bodyEffects.afterBodySaved(current.spaceId(), pageId, title, text, callerId);
    return pages.findDetail(pageId).orElseThrow(() -> new WikiPageNotFoundException(pageId));
  }
}
