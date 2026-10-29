package com.workplace.issue.service;

import com.workplace.global.util.SingleLineTitles;
import com.workplace.issue.dto.IssueExternalLinkView;
import com.workplace.issue.dto.IssueHistoryEventType;
import com.workplace.issue.dto.IssueRelationTypeRow;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.ResolvedExternalLink;
import com.workplace.issue.dto.SaveIssueExternalLinkRequest;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.exception.IssueRelationException;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.repository.IssueExternalLinkRepository;
import com.workplace.issue.repository.IssueExternalLinkRepository.LinkRow;
import com.workplace.issue.repository.IssueRelationTypeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueHistoryRecorder.ExternalLinkSnapshot;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.service.ProjectAccessGuard;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 이슈 외부 링크(WP-887) — 다른 시스템(Jira 등)에 남는 이슈를 관계 유형·키·제목·주소로 붙이고 고치고 지운다. 서버는 그 주소로 요청하지 않는다.
 *
 * <p>권한은 주소 이슈 프로젝트의 워크플로 편집({@code assertMember}) 하나다 — 외부 주소라 상대 프로젝트 읽기 검사가 없다. 이력은 이 이슈에만 남기고
 * 실시간 갱신은 {@code updatedWithoutTouch} 로 보낸다(알림·AI 작업 터치 없음). 외부 「차단」은 이 목록에만 있을 뿐 블로커 계산에 들어가지 않는다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueExternalLinkService {

  /** 이슈당 외부 링크 상한. */
  static final int MAX_PER_ISSUE = 50;

  /** 외부 링크 주소 최대 길이(DB 컬럼 길이). */
  private static final int MAX_URL_LENGTH = 2000;

  private final IssueExternalLinkRepository linkRepository;
  private final IssueRelationTypeRepository typeRepository;
  private final IssueRepository issueRepository;
  private final ProjectAccessGuard accessGuard;
  private final IssueHistoryRecorder historyRecorder;
  private final IssueChangeNotifier changeNotifier;

  // ── 조회 ────────────────────────────────────────────────────────────────────────────────

  /** 이슈의 외부 링크 목록 — 유형 정렬값 → 이 이슈 쪽 말 → 키 → id 순. 외부 주소라 조회자 권한으로 거르지 않는다(이슈를 읽을 수 있으면 전부 보인다). */
  @Transactional(readOnly = true)
  public List<IssueExternalLinkView> listFor(long issueId) {
    List<LinkRow> rows = linkRepository.findByIssue(issueId);
    if (rows.isEmpty()) {
      return List.of();
    }
    Map<Long, IssueRelationTypeRow> types = RelationListOrder.typesById(typeRepository);
    return rows.stream()
        .map(
            r -> {
              IssueRelationTypeRow type = types.get(r.typeId());
              return new IssueExternalLinkView(
                  r.id(),
                  r.typeId(),
                  type.code(),
                  type.labelFor(r.issueIsSource()),
                  IssueRelationService.sideOf(type, r.issueIsSource()),
                  r.url(),
                  r.key(),
                  r.title());
            })
        .sorted(
            RelationListOrder.byTypeThenLabel(
                    types, IssueExternalLinkView::typeId, IssueExternalLinkView::label)
                .thenComparing(v -> v.key() == null ? "" : v.key())
                .thenComparingLong(IssueExternalLinkView::id))
        .toList();
  }

  // ── 추가·수정·삭제 ──────────────────────────────────────────────────────────────────────

  /**
   * 외부 링크 한 줄 붙이기. 같은 주소가 이미 있으면 유형·방향이 같을 때만 그대로 둔다(이력·신호 없음 — 가져오기 재시도 대비), 다르면 409. 상한 50.
   *
   * @return 이 이슈의 갱신된 외부 링크 목록
   */
  public List<IssueExternalLinkView> add(
      long callerId, String projectKey, int number, SaveIssueExternalLinkRequest req) {
    ProjectRow project = accessGuard.assertMember(projectKey, callerId);
    // 이슈 행을 쓰기 잠금 — 같은 이슈에 동시에 붙이는 요청이 50개 상한 검사(센 뒤 넣기)를 함께 빠져나가지 않게 차례를 세운다.
    IssueRow issue =
        issueRepository
            .findByProjectAndNumberForUpdate(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    String url = normalizeUrl(req.url());
    IssueRelationTypeRow type = requireUsableType(req.typeId());
    boolean isSource = issueIsSource(type, IssueRelationService.parseSide(req.side()));

    String key = req.key();
    String title = req.title();

    if (!insertOrSkip(issue.id(), type, isSource, url, key, title, callerId)) {
      return listFor(issue.id());
    }
    historyRecorder.recordExternalLink(
        IssueHistoryEventType.EXTERNAL_LINK_ADDED.name(),
        callerId,
        issue.id(),
        null,
        new ExternalLinkSnapshot(type.labelFor(isSource), key, title, url));
    changeNotifier.updatedWithoutTouch(project, issue.number(), issue.id(), callerId);
    return listFor(issue.id());
  }

  /**
   * 외부 링크의 유형·방향·키·제목을 고친다(오타 정정) — 주소는 바꾸지 않는다(요청의 url 무시). 바뀐 게 없으면 이력 없이 그대로. 유형을 바꿀 때만 숨긴 유형을
   * 막는다(이미 숨긴 유형인 링크의 제목만 고치는 건 된다). 이 이슈의 링크가 아니면 404.
   *
   * @return 이 이슈의 갱신된 외부 링크 목록
   */
  public List<IssueExternalLinkView> update(
      long callerId, String projectKey, int number, long linkId, SaveIssueExternalLinkRequest req) {
    ProjectRow project = accessGuard.assertMember(projectKey, callerId);
    IssueRow issue = requireIssue(project, projectKey, number);
    LinkRow old =
        linkRepository
            .findById(linkId)
            .filter(l -> l.issueId() == issue.id())
            .orElseThrow(IssueRelationException::externalLinkNotFound);

    IssueRelationTypeRow oldType =
        typeRepository.findById(old.typeId()).orElseThrow(IssueRelationException::notFound);
    IssueRelationTypeRow type =
        req.typeId() == old.typeId() ? oldType : requireUsableType(req.typeId());
    // side 를 안 보내면(제목만 고치는 요청) 저장된 방향을 지킨다 — source 로 되돌리면 target 링크의 방향이 조용히 뒤집힌다.
    boolean requestedSource =
        req.side() == null || req.side().isBlank()
            ? old.issueIsSource()
            : IssueRelationService.parseSide(req.side());
    boolean isSource = issueIsSource(type, requestedSource);
    String key = req.key();
    String title = req.title();

    // 저장된 값도 같은 기준으로 다듬어 본다(WP-1171) — 다듬기 전에 저장된 옛 행(앞뒤 제로폭·줄바꿈)이 손대지 않은 저장에 「변경」 이력·알림을 남기거나,
    // 유형만 바꿨는데 이력에 제목·키까지 바뀐 것처럼 남지 않게.
    String oldKey = SingleLineTitles.normalizeOptional(old.key());
    String oldTitle = SingleLineTitles.normalize(old.title());
    if (type.id() == old.typeId()
        && isSource == old.issueIsSource()
        && Objects.equals(key, oldKey)
        && title.equals(oldTitle)) {
      // 보이는 값은 같지만 저장된 값이 다듬어지지 않았으면 이력·알림 없이 다듬은 값으로 고쳐 둔다.
      if (!Objects.equals(key, old.key()) || !title.equals(old.title())) {
        linkRepository.update(linkId, type.id(), isSource, key, title);
      }
      return listFor(issue.id());
    }
    linkRepository.update(linkId, type.id(), isSource, key, title);
    historyRecorder.recordExternalLink(
        IssueHistoryEventType.EXTERNAL_LINK_UPDATED.name(),
        callerId,
        issue.id(),
        new ExternalLinkSnapshot(
            oldType.labelFor(old.issueIsSource()), oldKey, oldTitle, old.url()),
        new ExternalLinkSnapshot(type.labelFor(isSource), key, title, old.url()));
    changeNotifier.updatedWithoutTouch(project, issue.number(), issue.id(), callerId);
    return listFor(issue.id());
  }

  /** 외부 링크 한 줄 지우기 — 없거나 이 이슈의 링크가 아니면 아무것도 하지 않는다(컨트롤러는 늘 204, 멱등). */
  public void remove(long callerId, String projectKey, int number, long linkId) {
    ProjectRow project = accessGuard.assertMember(projectKey, callerId);
    IssueRow issue = requireIssue(project, projectKey, number);
    LinkRow old =
        linkRepository.findById(linkId).filter(l -> l.issueId() == issue.id()).orElse(null);
    if (old == null || linkRepository.deleteById(linkId) == 0) {
      return;
    }
    IssueRelationTypeRow type =
        typeRepository.findById(old.typeId()).orElseThrow(IssueRelationException::notFound);
    historyRecorder.recordExternalLink(
        IssueHistoryEventType.EXTERNAL_LINK_REMOVED.name(),
        callerId,
        issue.id(),
        null,
        new ExternalLinkSnapshot(
            type.labelFor(old.issueIsSource()), old.key(), old.title(), old.url()));
    changeNotifier.updatedWithoutTouch(project, issue.number(), issue.id(), callerId);
  }

  // ── 가져오기 ────────────────────────────────────────────────────────────────────────────

  /**
   * 가져오기(이슈 생성)가 같은 트랜잭션에서 외부 링크를 넣는다 — 유형은 호출자가 이미 풀었고 주소도 {@link #normalizeUrl} 을 거쳤다. 이력·실시간 신호는
   * 내지 않는다(가져온 이슈는 이력 보존 규칙을 따로 쓴다). 같은 주소·유형·방향이 이미 있으면 건너뛰고(재시도 멱등), 같은 주소가 다른 유형·방향으로 있으면 {@code
   * EXTERNAL_LINK_CONFLICT}. 관리자 가져오기라 숨긴 유형도 쓸 수 있다(이관 직전에 유형을 숨겨 둬도 일괄이 실패하지 않게) — 화면에서 새로 거는
   * {@link #add}·유형을 바꾸는 {@link #update} 만 숨긴 유형을 막는다.
   */
  public void insertForImport(long issueId, long callerId, List<ResolvedExternalLink> links) {
    for (ResolvedExternalLink l : links) {
      IssueRelationTypeRow type = lockType(l.typeId());
      insertOrSkip(
          issueId,
          type,
          issueIsSource(type, l.issueIsSource()),
          normalizeUrl(l.url()),
          l.key(),
          l.title(),
          callerId);
    }
  }

  // ── 검사·정규화 ─────────────────────────────────────────────────────────────────────────

  /**
   * 외부 링크 주소 정규화 — 앞뒤 공백을 떼고 {@link URI} 로 읽어 스킴이 {@code http}/{@code https}(대소문자 무시)이고 호스트가 있을 때만
   * 받는다. 그 밖(javascript:·data:·ftp:·호스트 없음·공백 섞임·빈 값·2000자 초과)은 {@code EXTERNAL_LINK_URL_INVALID}.
   * 화면이 이 주소를 그대로 링크로 열므로 스킴 검사가 곧 XSS 방어다.
   */
  public static String normalizeUrl(String raw) {
    if (raw == null) {
      throw IssueRelationException.externalLinkUrlInvalid();
    }
    String url = raw.trim();
    if (url.isEmpty() || url.length() > MAX_URL_LENGTH) {
      throw IssueRelationException.externalLinkUrlInvalid();
    }
    URI uri;
    try {
      uri = new URI(url);
    } catch (URISyntaxException e) {
      throw IssueRelationException.externalLinkUrlInvalid();
    }
    String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
    if (!(scheme.equals("http") || scheme.equals("https"))
        || uri.getHost() == null
        || uri.getHost().isBlank()) {
      throw IssueRelationException.externalLinkUrlInvalid();
    }
    return url;
  }

  /**
   * 저장할 방향 — 방향 없는 유형은 이 이슈가 A 쪽인지 의미가 없어 늘 true 로 저장한다(유형 삭제 때 옮기기와 같은 규약). B 쪽 말이 없는 방향 있는 유형(상위
   * 에픽 — 외부에서 이 이슈가 A)을 target 으로 달라면 400 이다(추가·수정·가져오기 공통).
   */
  private static boolean issueIsSource(IssueRelationTypeRow type, boolean requestedSource) {
    IssueRelationService.assertSideAllowed(type, requestedSource);
    return !type.directed() || requestedSource;
  }

  /**
   * 새로 붙일 수 있는 유형 — 없음 404, 숨김 400. 유형 행을 공유 잠금(FOR SHARE)해 같은 순간의 유형 삭제와 차례를 세운다(삭제가 이 커밋을 기다려 넣은
   * 링크까지 보고 옮기거나 지운다). 차단(BLOCKS)·외부 전용(PARENT_EPIC)도 외부 링크에는 쓸 수 있다.
   */
  private IssueRelationTypeRow requireUsableType(long typeId) {
    IssueRelationTypeRow type = lockType(typeId);
    if (type.hidden()) {
      throw IssueRelationException.typeHidden();
    }
    return type;
  }

  /** 유형을 공유 잠금(FOR SHARE)으로 읽는다 — 없으면 404. 숨김은 따지지 않는다(가져오기 경로). */
  private IssueRelationTypeRow lockType(long typeId) {
    return typeRepository.findByIdForShare(typeId).orElseThrow(IssueRelationException::notFound);
  }

  /**
   * 한 줄 넣기 공통 — 같은 주소가 이미 있으면 유형·방향이 같을 때만 건너뛰고(false) 다르면 409, 상한 50 검사 뒤 넣는다. 동시 요청이 같은 주소를 먼저
   * 넣었어도 ON CONFLICT 로 한 줄만 남고 같은 규칙으로 판단한다.
   *
   * @return 새로 넣었으면 true, 이미 같은 링크가 있어 건너뛰었으면 false
   */
  private boolean insertOrSkip(
      long issueId,
      IssueRelationTypeRow type,
      boolean isSource,
      String url,
      String key,
      String title,
      long callerId) {
    LinkRow existing = linkRepository.findByIssueAndUrl(issueId, url).orElse(null);
    if (existing != null) {
      return skipOrConflict(existing, type, isSource);
    }
    if (linkRepository.countByIssue(issueId) >= MAX_PER_ISSUE) {
      throw IssueRelationException.externalLinkLimit(MAX_PER_ISSUE);
    }
    if (linkRepository.insertIfAbsent(issueId, type.id(), isSource, url, key, title, callerId)) {
      return true;
    }
    // 같은 순간 다른 요청이 먼저 넣었다 — 그 행을 읽어 같은 규칙으로 판단한다.
    return skipOrConflict(
        linkRepository.findByIssueAndUrl(issueId, url).orElseThrow(), type, isSource);
  }

  private static boolean skipOrConflict(
      LinkRow existing, IssueRelationTypeRow type, boolean isSource) {
    if (existing.typeId() == type.id() && existing.issueIsSource() == isSource) {
      return false;
    }
    throw IssueRelationException.externalLinkConflict();
  }

  private IssueRow requireIssue(ProjectRow project, String projectKey, int number) {
    return issueRepository
        .findByProjectAndNumber(project.id(), number)
        .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
  }
}
