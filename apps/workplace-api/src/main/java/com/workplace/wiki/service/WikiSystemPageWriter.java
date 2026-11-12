package com.workplace.wiki.service;

import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiSpaceRepository;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.function.ToIntFunction;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 서버가 스스로 쓰는 노트 페이지의 좁은 공개 입구(WP-1483 프로젝트 리포트). 역할 검사 없는 만들기·본문 쓰기·자리 옮기기·「AI 작성」 표지와 프로젝트 노트 공간의
 * 「리포트」 페이지 찾기/만들기를 감싼다.
 *
 * <p>왜 따로 두나: 실행기에는 사용자 세션이 없고, 작성자(리포트 작성자 규칙 — 소유자 또는 가장 작은 OWNER id)나 설정을 켠 ADMIN 이 공간 멤버가 아닐 수
 * 있다. 사람 요청 경로({@link WikiPageService#create}·{@link WikiPageService#save})는 공간 역할을 요구하므로 쓸 수 없고,
 * 역할 검사 없는 내부 메서드는 package-private 이라 다른 패키지(wiki/report)가 부를 수 없다. 이 클래스만 그 내부 메서드를 공개로 감싸 범위를 좁게
 * 유지한다.
 *
 * <p>「AI 작성」 표지는 {@code WikiAiAction} enum 에 넣지 않고 문자열 {@code "report"} 를 여기서만 기록한다 — enum 은 노트 /ai
 * 요청이 받는 값이라 더하면 사용자가 report 액션을 보낼 수 있게 된다(설계 「내가 정한 것」).
 */
@Service
@RequiredArgsConstructor
public class WikiSystemPageWriter {

  /** 리포트 페이지의 AI 표지 값 — wiki_page.ai_last_action. */
  public static final String AI_ACTION_REPORT = "report";

  private final WikiPageService pageService;
  private final ProjectNoteSpaceService noteSpaces;
  private final WikiPageRepository pages;
  private final WikiSpaceRepository spaces;
  private final WikiSpaceService spaceService;

  /** 개인 보고의 맨 위 페이지 제목(내 노트 › 보고). */
  public static final String PERSONAL_REPORTS_TITLE = "보고";

  /** 프로젝트 노트 공간과 그 「리포트」 페이지. */
  public record ReportsHome(long spaceId, long reportsPageId) {}

  /**
   * 프로젝트의 「리포트」 자리를 보장한다 — 공간이 없으면 만들고(프로젝트 노트 공간 규칙 그대로), 「리포트」가 없거나 이름이 바뀌었으면 맨 위에 새로 만든다.
   *
   * @param authorId 새로 만드는 「리포트」의 작성자(리포트 작성자 규칙 — 소유자 또는 가장 작은 OWNER id)
   * @return 공간을 둘 수 없는 프로젝트(개인·지워짐·없음)면 empty
   */
  @Transactional
  public Optional<ReportsHome> ensureReportsHome(long projectId, long authorId) {
    Optional<Long> spaceId =
        spaces.findIdByLinkedProject(projectId).or(() -> noteSpaces.ensureSpace(projectId, null));
    return spaceId.map(
        id ->
            new ReportsHome(
                id, noteSpaces.ensureRootPage(id, ProjectNoteSpaceService.REPORT_TITLE, authorId)));
  }

  /** 내 노트(PERSONAL) 공간과 그 「보고」 페이지. */
  public record PersonalReportsHome(long spaceId, long reportsPageId) {}

  /**
   * 본인의 「내 노트」 PERSONAL 공간과 그 맨 위 「보고」를 보장한다(WP-1486) — 공간이 없으면 만들고, 「보고」가 없거나 이름이 바뀌었으면 맨 위에 새로
   * 만든다. 공간은 언제나 {@code type='PERSONAL' AND owner=userId} 로 얻고 저장 위치를 입력으로 받지 않는다 — 사용자가 팀 공간 OWNER
   * 여도 팀 공간에 두지 않으며, 다른 사람 id 를 받는 별도 공개 메서드도 두지 않는다.
   */
  @Transactional
  public PersonalReportsHome ensurePersonalReportsHome(long userId) {
    long spaceId = spaceService.ensurePersonalSpace(userId).id();
    return new PersonalReportsHome(
        spaceId, noteSpaces.ensureRootPage(spaceId, PERSONAL_REPORTS_TITLE, userId));
  }

  /** 본인의 PERSONAL 공간과 「보고」가 둘 다 이미 있을 때만 돌려준다 — 아무것도 만들지 않는다(설정 화면이 읽기만 할 때). 하나라도 없으면 empty. */
  @Transactional(readOnly = true)
  public Optional<PersonalReportsHome> findPersonalReportsHome(long userId) {
    return spaces
        .findPersonalSpaceId(userId)
        .flatMap(
            spaceId ->
                noteSpaces
                    .findRootPage(spaceId, PERSONAL_REPORTS_TITLE)
                    .map(pageId -> new PersonalReportsHome(spaceId, pageId)));
  }

  /**
   * parentId 바로 아래의 빈 본문 폴더 페이지를 보장해 id 를 돌려준다(WP-1486). 공간 트리를 잠근 뒤 같은 제목을 찾고(여럿이면 작은 id), 없으면 만들어
   * positionFor 가 정한 자리로 옮긴다 — 동시 호출이 같은 제목 폴더를 둘 만들지 않게 한다. 자리는 잠근 뒤 읽은 형제 제목(화면 순서)으로 정하므로 「최신 달이
   * 위」처럼 형제 사이 순서를 지키는 자리도 경합 없이 계산된다. 역할 검사는 하지 않는다.
   *
   * @param positionFor 새 폴더를 만들 때만 부른다 — 기존 형제 제목(화면 순서, 새 폴더 제외)을 받아 옮길 자리(0부터)를 돌려준다
   */
  @Transactional
  public long ensureChildFolder(
      long spaceId,
      long parentId,
      String title,
      long authorId,
      ToIntFunction<List<String>> positionFor) {
    pages.lockSpaceTree(spaceId);
    List<Long> children = pages.childIdsOrdered(spaceId, parentId);
    Map<Long, String> titles = pages.findTitles(children);
    Optional<Long> found =
        children.stream().filter(id -> title.equals(titles.get(id))).min(Long::compare);
    if (found.isPresent()) {
      return found.get();
    }
    int position = positionFor.applyAsInt(children.stream().map(titles::get).toList());
    long id =
        pageService
            .createWithoutRoleCheck(authorId, spaceId, new CreatePageRequest(parentId, title))
            .id();
    pageService.moveAsSystem(authorId, id, parentId, position);
    return id;
  }

  /**
   * 공간 트리 잠금(트랜잭션 advisory 락 — 만들기·옮기기·{@link #ensureChildFolder} 가 잡는 것과 같은 잠금)을 부른 쪽 트랜잭션에서
   * 잡는다(WP-1486). 「찾고 없으면 만들기」를 여러 단계로 하는 쪽(개인 보고 템플릿)이 잠근 뒤 다시 찾아 같은 페이지를 둘 만들지 않게 할 때 쓴다. 트랜잭션
   * 밖에서 부르면 잠금이 곧바로 풀려 뜻이 없으므로 바깥 트랜잭션을 요구한다.
   */
  @Transactional(propagation = Propagation.MANDATORY)
  public void lockSpaceTree(long spaceId) {
    pages.lockSpaceTree(spaceId);
  }

  /** 역할 검사 없이 페이지를 만든다(맨 끝 자리). 부모는 같은 공간이어야 한다. */
  @Transactional
  public WikiPageDetail createPage(long authorId, long spaceId, Long parentId, String title) {
    return pageService.createWithoutRoleCheck(
        authorId, spaceId, new CreatePageRequest(parentId, title));
  }

  /**
   * 역할 검사 없이 본문(마크다운)을 쓴다. 동기화 서버가 켜져 있으면 병합 위임 경로라 <b>트랜잭션 밖에서</b> 불러야 한다.
   *
   * @param version 쓴 쪽이 읽은 판(만들기 응답·{@link #findPage} 의 version)
   * @param ai AI 가 쓴 본문이면 true
   * @param snapshot 직전 판을 수정 기록으로 남길지(템플릿 되돌리기)
   */
  public WikiPageDetail writeBody(
      long authorId, long pageId, int version, String markdown, boolean ai, boolean snapshot) {
    return pageService.saveAsSystem(
        authorId, pageId, new SavePageRequest(null, markdown, version, snapshot), ai, snapshot);
  }

  /**
   * 같은 공간의 parentId 아래 position 자리로 옮기고 형제를 다시 번호 매긴다(이동 이벤트 발행). 행위자는 그 페이지를 마지막으로 쓴 사람(서버가 쓴 페이지면
   * 작성자)이다.
   */
  @Transactional
  public void moveTo(long pageId, long parentId, int position) {
    Long actor = pages.findDetail(pageId).map(WikiPageDetail::updatedBy).orElse(null);
    pageService.moveAsSystem(actor, pageId, parentId, position);
  }

  /** 「AI 작성」 표지 — ai_last_action='report', ai_last_used_at=at. version·수정자·수정 시각은 건드리지 않는다. */
  @Transactional
  public void markAiReport(long pageId, OffsetDateTime at) {
    pages.recordAiUsage(pageId, AI_ACTION_REPORT, at);
  }

  /** 공간의 「리포트」 페이지 id(만들지 않는다) — 개요 카드 「노트에서 모두 보기」(WP-1483). 지웠거나 이름을 바꿨으면 empty. */
  @Transactional(readOnly = true)
  public Optional<Long> findReportsPage(long spaceId) {
    return noteSpaces.findRootPage(spaceId, ProjectNoteSpaceService.REPORT_TITLE);
  }

  /** 페이지 상세(역할 검사 없음). 없으면 empty. */
  @Transactional(readOnly = true)
  public Optional<WikiPageDetail> findPage(long pageId) {
    return pages.findDetail(pageId);
  }

  /** 페이지 제목만(본문을 읽지 않는다). 없으면 empty. */
  @Transactional(readOnly = true)
  public Optional<String> findTitle(long pageId) {
    return pages.findTitle(pageId);
  }

  /** 페이지 마지막 수정 시각만(본문을 읽지 않는다). 없으면 empty. */
  @Transactional(readOnly = true)
  public Optional<OffsetDateTime> findUpdatedAt(long pageId) {
    return pages.findUpdatedAt(pageId);
  }

  /** 페이지 본문(마크다운). 없으면 empty. */
  @Transactional(readOnly = true)
  public Optional<String> readBody(long pageId) {
    return pages.findDetail(pageId).map(WikiPageDetail::body);
  }

  /** 페이지가 있고 parentId 의 바로 아래 자식인지 — 템플릿이 「리포트」 밖으로 옮겨졌거나 지워졌는지 판정. */
  @Transactional(readOnly = true)
  public boolean existsUnder(long pageId, long parentId) {
    // 없는 페이지·맨 위 페이지는 부모가 null 이라 false — 본문까지 읽지 않고 부모 id 만 본다.
    return Objects.equals(pages.findParentId(pageId), parentId);
  }

  /** parentId 의 자식 id 를 화면 순서(position, id)로. 부모가 없으면 빈 목록. */
  @Transactional(readOnly = true)
  public List<Long> childIdsOrdered(long parentId) {
    return pages
        .findSpaceId(parentId)
        .map(spaceId -> pages.childIdsOrdered(spaceId, parentId))
        .orElse(List.of());
  }
}
