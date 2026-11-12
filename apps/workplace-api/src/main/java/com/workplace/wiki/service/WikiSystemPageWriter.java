package com.workplace.wiki.service;

import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiSpaceRepository;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
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
    return spaceId.map(id -> new ReportsHome(id, noteSpaces.ensureReportPage(id, authorId)));
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
    return noteSpaces.findReportPage(spaceId);
  }

  /** 페이지 상세(역할 검사 없음). 없으면 empty. */
  @Transactional(readOnly = true)
  public Optional<WikiPageDetail> findPage(long pageId) {
    return pages.findDetail(pageId);
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
