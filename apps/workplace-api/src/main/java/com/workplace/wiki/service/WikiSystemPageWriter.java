package com.workplace.wiki.service;

import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.SavePageRequest;
import com.workplace.wiki.dto.WikiPageDetail;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiSpaceRepository;
import java.time.OffsetDateTime;
import java.util.HashSet;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
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

  /** 경로 제목을 모을 때 올라가는 깊이 상한(WP-1654) — 깨진 부모 고리에서도 끝나게. */
  private static final int PATH_DEPTH_MAX = 64;

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
    return ensureProjectSpace(projectId)
        .map(id -> new ReportsHome(id, ensureReportsPage(id, authorId)));
  }

  /**
   * 프로젝트 노트 공간만 보장한다(WP-1654) — 이미 이어진 공간이 있으면 그것, 없으면 프로젝트 노트 공간 규칙대로 만든다. 「리포트」는 만들지 않는다(저장 위치를
   * 고른 프로젝트에서 사람이 지운 「리포트」를 되살리지 않게 — 「리포트」가 필요할 때만 {@link #ensureReportsPage} 로 만든다). 이어진 공간이 있으면
   * 프로젝트 잠금·멤버 맞추기를 거치지 않는다(생성마다 부르므로).
   *
   * @return 공간을 둘 수 없는 프로젝트(개인·지워짐·없음)면 empty
   */
  @Transactional
  public Optional<Long> ensureProjectSpace(long projectId) {
    return spaces
        .findIdByLinkedProject(projectId)
        .or(() -> noteSpaces.ensureSpace(projectId, null));
  }

  /** 공간의 맨 위 「리포트」를 보장한다(WP-1654) — 없거나 이름이 바뀌었으면 맨 위 0번에 만든다(공간 트리 잠금 아래). */
  @Transactional
  public long ensureReportsPage(long spaceId, long authorId) {
    return noteSpaces.ensureRootPage(spaceId, ProjectNoteSpaceService.REPORT_TITLE, authorId);
  }

  /**
   * 공간의 맨 위 「템플릿」을 보장한다(WP-1654) — 프로젝트 정기 리포트 템플릿을 리포트와 나눠 두는 자리. 없거나 이름이 바뀌었으면 맨 위 0번에 만든다(공간 트리
   * 잠금 아래 — 동시에 불러도 하나).
   */
  @Transactional
  public long ensureTemplatesPage(long spaceId, long authorId) {
    return noteSpaces.ensureRootPage(spaceId, ProjectNoteSpaceService.TEMPLATES_TITLE, authorId);
  }

  /** 프로젝트에 이어진 노트 공간 id(WP-1654, 만들지 않는다) — 설정 화면·개요 카드처럼 읽기만 할 때. 없으면 empty. */
  @Transactional(readOnly = true)
  public Optional<Long> findLinkedSpace(long projectId) {
    return spaces.findIdByLinkedProject(projectId);
  }

  /** 공간의 맨 위 「템플릿」 id(WP-1654, 만들지 않는다). 지웠거나 이름을 바꿨으면 empty. */
  @Transactional(readOnly = true)
  public Optional<Long> findTemplatesPage(long spaceId) {
    return noteSpaces.findRootPage(spaceId, ProjectNoteSpaceService.TEMPLATES_TITLE);
  }

  /**
   * 페이지가 있고 그 공간에 속하는가(WP-1654) — 템플릿·저장 위치가 지워졌거나 다른 공간으로 옮겨졌는지 본다. id 가 null 이면 false. 같은 공간이면
   * 어디로 옮겼든 true(사람이 옮긴 자리를 따른다).
   */
  @Transactional(readOnly = true)
  public boolean existsInSpace(Long pageId, long spaceId) {
    return pageId != null && pages.findSpaceId(pageId).map(id -> id == spaceId).orElse(false);
  }

  /**
   * 루트에서 그 페이지까지의 제목 경로(WP-1654) — 설정 화면의 「템플릿 › 정기 리포트」·저장 위치 표시. 없는 페이지면 빈 목록.
   *
   * <p>재귀 CTE({@code ancestorIdsInclusive})는 결과 순서를 보장하지 않으므로 부모를 하나씩 따라 올라가며 순서대로 모은다. 깨진 데이터로 부모가
   * 돌고 돌아도 끝나도록 방문 집합과 깊이 상한을 둔다.
   */
  @Transactional(readOnly = true)
  public List<String> pathTitles(long pageId) {
    if (pages.findSpaceId(pageId).isEmpty()) {
      // 없는 페이지 — findParentId 가 null(맨 위)과 구분되지 않으므로 먼저 거른다.
      return List.of();
    }
    LinkedList<Long> chain = new LinkedList<>();
    Set<Long> seen = new HashSet<>();
    Long current = pageId;
    while (current != null && seen.add(current) && chain.size() < PATH_DEPTH_MAX) {
      chain.addFirst(current);
      current = pages.findParentId(current);
    }
    Map<Long, String> titles = pages.findTitles(chain);
    return chain.stream().map(id -> titles.getOrDefault(id, "")).toList();
  }

  /** pageId 가 ancestorId 자신이거나 그 갈래(하위) 안인가(WP-1654) — 저장 위치가 「템플릿」 갈래·템플릿 페이지 갈래인지 판정. */
  @Transactional(readOnly = true)
  public boolean isUnderOrSelf(long pageId, long ancestorId) {
    return pages.ancestorIdsInclusive(pageId).contains(ancestorId);
  }

  /**
   * 역할 검사 없이 제목만 바꾼다(WP-1654 — 옛 「템플릿 · 주간 리포트」를 「정기 리포트」로). 본문을 보내지 않으므로 동기화 서버 위임 없이 트랜잭션 안 경로를
   * 탄다 — 공간 트리 잠금을 쥔 트랜잭션 안에서도 부를 수 있다. 본문은 그대로다.
   */
  @Transactional
  public void renameTo(long pageId, String title, long actorId) {
    pageService.saveAsSystem(
        actorId, pageId, new SavePageRequest(title, null, null, false), false, false);
  }

  /** 본인의 「내 노트」 PERSONAL 공간 id(WP-1655, 만들지 않는다) — 설정 화면·저장 위치 검증처럼 읽기만 할 때. 없으면 empty. */
  @Transactional(readOnly = true)
  public Optional<Long> findPersonalSpace(long userId) {
    return spaces.findPersonalSpaceId(userId);
  }

  /**
   * 본인의 「내 노트」 PERSONAL 공간만 보장한다(WP-1655) — 「보고」는 만들지 않는다(저장 위치를 고른 사람에게 「보고」를 되살리지 않게 — 필요할 때만
   * {@link #ensurePersonalReportsPage} 로 만든다). 공간은 언제나 {@code type='PERSONAL' AND owner=userId} 로
   * 얻는다.
   */
  @Transactional
  public long ensurePersonalSpace(long userId) {
    return spaceService.ensurePersonalSpace(userId).id();
  }

  /** 개인 공간의 맨 위 「보고」 id(WP-1655, 만들지 않는다). 지웠거나 이름을 바꿨으면 empty. */
  @Transactional(readOnly = true)
  public Optional<Long> findPersonalReportsPage(long spaceId) {
    return noteSpaces.findRootPage(spaceId, PERSONAL_REPORTS_TITLE);
  }

  /** 개인 공간의 맨 위 「보고」를 보장한다(WP-1655) — 없거나 이름이 바뀌었으면 맨 위에 만든다(공간 트리 잠금 아래 — 동시에 불러도 하나). */
  @Transactional
  public long ensurePersonalReportsPage(long spaceId, long userId) {
    return noteSpaces.ensureRootPage(spaceId, PERSONAL_REPORTS_TITLE, userId);
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
