package com.workplace.wiki.service;

import com.workplace.global.tenant.TenantStatusChecker;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.dto.WikiPageSummary;
import com.workplace.wiki.dto.WikiPublicShareResponse;
import com.workplace.wiki.dto.WikiPublicShareResponse.PublicPage;
import com.workplace.wiki.dto.WikiPublicShareResponse.PublicPageBody;
import com.workplace.wiki.dto.WikiSharePreview;
import com.workplace.wiki.exception.WikiShareLoginRequiredException;
import com.workplace.wiki.exception.WikiShareNotFoundException;
import com.workplace.wiki.repository.WikiAttachmentRepository;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiPageRepository.PreviewSource;
import com.workplace.wiki.repository.WikiShareRepository;
import com.workplace.wiki.repository.WikiShareRepository.ShareRow;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 노트 외부(비로그인) 공유 보기(WP-579, 설계 「접근 판정」 외부·「볼 수 없는 링크 가림」).
 *
 * <p>비로그인 요청에는 테넌트 GUC 가 없어 RLS 로는 공유 행이 보이지 않는다. 그래서 드라이브 공개 링크({@code
 * PublicDriveShareController})와 같은 2단계로 연다: ① {@link #locateTenant}·{@link #locatePublicTenant} —
 * SECURITY DEFINER 함수로 토큰의 워크스페이스만 찾는다(트랜잭션 없음). ② 컨트롤러가 그 워크스페이스로 {@code TenantContext} 를 세운 뒤
 * {@link #view}·{@link #attachment} 를 부른다 — 이 트랜잭션이 시작될 때 GUC 가 그 테넌트로 들어가 이후 조회는 평소처럼 RLS 아래에서 돈다.
 * 같은 빈 안에서 두 단계를 잇지 않는다(자기 호출은 트랜잭션 경계를 만들지 못한다).
 *
 * <p>모든 「열 수 없음」(없는 토큰·만료·해제·재발급·외부 공유 꺼짐·범위 밖 페이지·바인딩 안 된 첨부·정지된 워크스페이스)은 같은 404 문구다 — 응답 차이로
 * 토큰·페이지·파일의 존재를 가늠하지 못하게. 예외는 만료 전 내부(WORKSPACE·PEOPLE) 링크의 보기뿐이라 401 로 로그인 화면에 보낸다(설계 「받는 쪽」).
 *
 * <p>성공한 보기(페이지 이동 포함)마다 조회 수·마지막 열람 시각을 올린다(로그인 경로 {@code WikiShareLinkService} 와 같은 규칙, 첨부 요청은 세지
 * 않는다). 열람은 감사 로그에 남기지 않는다.
 */
@Service
@RequiredArgsConstructor
public class WikiPublicShareService {
  private static final String NOT_FOUND = "열 수 없는 링크입니다";

  /** 제목 없는 노트의 미리보기 제목 — 노트 화면의 빈 제목 자리표시와 같은 말. */
  static final String UNTITLED = "제목 없음";

  private final WikiShareRepository shares;
  private final WikiPageRepository pages;
  private final WikiAttachmentRepository attachments;
  private final WikiAttachmentStorage storage;
  private final WikiShareAccess access;
  private final WikiPublicMarkdownMasker masker;
  private final TenantStatusChecker tenantStatus;

  /**
   * 보기 요청의 워크스페이스 — 외부로 열 수 있는 링크면 그 워크스페이스, 아니면 내부 링크일 수 있으니(401 판정은 그 테넌트 안에서) 대상·만료와 무관하게 토큰의
   * 워크스페이스. 정지·삭제된 워크스페이스의 링크는 없는 링크다(드라이브 공개 링크와 같다, WP-341).
   *
   * @throws WikiShareNotFoundException 없는 토큰·활성이 아닌 워크스페이스
   */
  public long locateTenant(String token) {
    Long tenantId =
        shares
            .findPublicTenantOfToken(token)
            .or(() -> shares.findTenantOfToken(token))
            .orElseThrow(WikiPublicShareService::notFound);
    return requireActive(tenantId);
  }

  /**
   * 첨부 요청의 워크스페이스 — 외부로 열 수 있는 링크만(이미지 요청은 로그인으로 이어지지 않으므로 내부 링크도 404).
   *
   * @throws WikiShareNotFoundException 외부로 열 수 없는 토큰·활성이 아닌 워크스페이스
   */
  public long locatePublicTenant(String token) {
    return requireActive(
        shares.findPublicTenantOfToken(token).orElseThrow(WikiPublicShareService::notFound));
  }

  /**
   * 외부 보기 — 지금 테넌트 컨텍스트가 토큰의 워크스페이스여야 한다({@link #locateTenant} 뒤 컨트롤러가 세운다).
   *
   * @param pageId 볼 페이지(null 이면 공유한 페이지). 공유의 지금 범위 안이어야 한다
   * @throws WikiShareLoginRequiredException 만료 전 내부 링크(401)
   * @throws WikiShareNotFoundException 그 밖의 열 수 없음(404)
   */
  @Transactional
  public WikiPublicShareResponse view(long tenantId, String token, Long pageId) {
    Opened opened = open(token, pageId);
    ShareRow share = opened.share();
    WikiPageDetail detail =
        pages.findDetail(opened.target()).orElseThrow(WikiPublicShareService::notFound);

    List<WikiPageSummary> summaries = sharedPages(share);
    Map<Long, String> titles = titlesOf(summaries);

    WikiPublicShareResponse res =
        new WikiPublicShareResponse(
            shares.findTenantName(tenantId).orElse(""),
            share.pageId(),
            summaries.stream()
                .map(s -> new PublicPage(s.id(), s.parentId(), s.title(), s.position()))
                .toList(),
            new PublicPageBody(
                detail.id(),
                detail.title(),
                masker.mask(detail.body(), titles, token),
                detail.updatedAt(),
                detail.fullWidth()));
    shares.recordView(share.id());
    return res;
  }

  /**
   * 링크 미리보기(WP-895) — 외부 메신저 봇이 공유 링크를 읽을 때 카드에 넣을 노트 제목·본문 앞부분. 보기({@link #view})와 같은 판정으로 연 페이지만,
   * 보기와 같은 가림을 거친 본문으로 만든다. 제목이 비면 「제목 없음」, 본문이 비면 설명도 제목. 열람 수는 올리지 않는다(사람이 연 것이 아니다). 지금 테넌트
   * 컨텍스트가 토큰의 워크스페이스여야 한다.
   *
   * @param pageId 공유된 하위 페이지 주소일 때(없으면 공유한 페이지)
   * @throws WikiShareLoginRequiredException 내부 링크
   * @throws WikiShareNotFoundException 그 밖의 열 수 없음 — 호출부는 둘 다 사이트 공통 카드를 쓴다
   */
  @Transactional(readOnly = true)
  public WikiSharePreview preview(String token, Long pageId) {
    Opened opened = open(token, pageId);
    PreviewSource source =
        pages
            .findPreviewSource(opened.target(), WikiPreviewText.SOURCE_LIMIT)
            .orElseThrow(WikiPublicShareService::notFound);
    String title =
        source.title() == null || source.title().isBlank() ? UNTITLED : source.title().strip();
    String description =
        WikiPreviewText.excerpt(
            masker.mask(source.bodyHead(), titlesOf(sharedPages(opened.share())), token));
    return new WikiSharePreview(title, description.isEmpty() ? title : description);
  }

  /** 외부로 연 공유와 볼 페이지. */
  private record Opened(ShareRow share, long target) {}

  /**
   * 외부 보기·미리보기 공통 판정 — 살아 있는 링크, PUBLIC, 볼 페이지가 공유 범위 안. 범위·외부 정책 판정은 한 곳(WikiShareAccess)에서 —
   * 비로그인(userId null)은 PUBLIC 공유만 열린다. 이미 읽은 공유 행으로 판정해 토큰을 다시 조회하지 않는다.
   *
   * @throws WikiShareLoginRequiredException 만료 전 내부 링크
   * @throws WikiShareNotFoundException 그 밖의 열 수 없음
   */
  private Opened open(String token, Long pageId) {
    ShareRow share = shares.findActiveByToken(token).orElseThrow(WikiPublicShareService::notFound);
    if (!"PUBLIC".equals(share.audience())) {
      throw new WikiShareLoginRequiredException();
    }
    long target = pageId != null ? pageId : share.pageId();
    access.grant(share, target, null).orElseThrow(WikiPublicShareService::notFound);
    return new Opened(share, target);
  }

  /** 링크로 볼 수 있는 페이지 — 하위 포함이면 공유한 페이지의 서브트리, 아니면 그 페이지 하나. */
  private List<WikiPageSummary> sharedPages(ShareRow share) {
    List<Long> covered =
        share.includeChildren()
            ? pages.subtreeIdsInclusive(share.pageId())
            : List.of(share.pageId());
    return shares.listSharedPages(covered, share.pageId());
  }

  /** 페이지 id → 제목(범위 순서 유지) — 본문 가림이 범위 판정에 쓴다. */
  private static Map<Long, String> titlesOf(List<WikiPageSummary> summaries) {
    Map<Long, String> titles = new LinkedHashMap<>();
    summaries.forEach(s -> titles.put(s.id(), s.title()));
    return titles;
  }

  /**
   * 외부 보기 본문 이미지 — 공유 범위 안 페이지에, 그 페이지에 붙은 첨부만. 지금 테넌트 컨텍스트가 토큰의 워크스페이스여야 한다.
   *
   * @throws WikiShareNotFoundException 범위 밖 페이지·바인딩 안 된 파일·외부로 열 수 없는 링크(404)
   */
  @Transactional(readOnly = true)
  public WikiAttachmentStorage.StoredFile attachment(String token, long pageId, long fileId) {
    access.grant(pageId, null, token).orElseThrow(WikiPublicShareService::notFound);
    Long boundPageId = attachments.findPageId(fileId).orElse(null);
    if (boundPageId == null || boundPageId != pageId) {
      throw notFound();
    }
    return storage.load(fileId);
  }

  private long requireActive(long tenantId) {
    if (!tenantStatus.isActive(tenantId)) {
      throw notFound();
    }
    return tenantId;
  }

  private static WikiShareNotFoundException notFound() {
    return new WikiShareNotFoundException(NOT_FOUND);
  }
}
