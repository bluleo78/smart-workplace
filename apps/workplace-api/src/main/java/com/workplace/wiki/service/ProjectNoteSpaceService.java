package com.workplace.wiki.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.UnicodeNames;
import com.workplace.wiki.dto.CreatePageRequest;
import com.workplace.wiki.dto.MovePageRequest;
import com.workplace.wiki.dto.WikiProjectSpaceResponse;
import com.workplace.wiki.exception.WikiForbiddenException;
import com.workplace.wiki.exception.WikiProjectSpaceConflictException;
import com.workplace.wiki.exception.WikiSpaceNotFoundException;
import com.workplace.wiki.outbound.WikiChangeNotifier;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiSpaceAudienceChangedEvent;
import com.workplace.wiki.outbound.WikiDomainEvents.WikiSpaceMembershipChangedEvent;
import com.workplace.wiki.repository.ProjectNoteSpaceRepository;
import com.workplace.wiki.repository.ProjectNoteSpaceRepository.ProjectInfo;
import com.workplace.wiki.repository.WikiPageRepository;
import com.workplace.wiki.repository.WikiSpaceMemberGroupRepository;
import com.workplace.wiki.repository.WikiSpaceMemberRepository;
import com.workplace.wiki.repository.WikiSpaceRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 프로젝트 노트 공간(WP-1480) — 팀·공개(TEAM·OPEN) 프로젝트마다 노트 공간 하나를 두고, 그 멤버를 프로젝트 멤버에 맞춘다. 프로젝트가 진실이고 공간은
 * 따라간다: 프로젝트를 만들면 공간(+ 첫 페이지 「리포트」)이 생기고, 멤버·부서·이름이 바뀌면 공간에 반영되고, 프로젝트를 지우면 연결만 끊겨 일반 팀 공간으로 남는다.
 *
 * <p>프로젝트 쪽 변경은 {@code ProjectNoteSpaceListener} 가 프로젝트 변경 이벤트로 받아 같은 트랜잭션에서 부른다 — 동기화가 실패하면 프로젝트
 * 변경도 함께 롤백된다(프로젝트 멤버와 공간 멤버가 어긋난 채로 커밋되지 않게). 프로젝트 테이블은 {@link ProjectNoteSpaceRepository} 로만
 * 읽는다(도메인 간 자바 의존 금지).
 *
 * <p>멤버 매핑: 프로젝트 OWNER → 공간 OWNER, MEMBER(사람·AI) → EDITOR, 프로젝트 멤버 부서 → 공간 부서 EDITOR. 그 밖의 공간 직접
 * 멤버·부서는 뺀다. 테넌트 ADMIN 은 프로젝트 멤버 행이 없으면 넣지 않는다. 「마지막 OWNER」 보호는 맞추기에 적용하지 않는다 — 프로젝트 쪽이 소유자를 정한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ProjectNoteSpaceService {
  /** 처음 만들 때 넣는 맨 위 페이지 제목 — 연결(link) 때 이 제목의 맨 위 페이지를 대상 공간으로 옮긴다. */
  static final String REPORT_TITLE = "리포트";

  /** 같은 이름의 팀 공간이 있을 때 붙이는 말 — 「X」 → 「X 프로젝트」 → 「X 프로젝트 2」 …(설계 결정). */
  private static final String NAME_SUFFIX = " 프로젝트";

  private static final String OWNER = "OWNER";

  /** 이미 다른 프로젝트에 이어진 공간을 연결하려 할 때의 409 문구. */
  private static final String ALREADY_LINKED = "이미 프로젝트에 연결된 노트 공간입니다";

  private static final String EDITOR = "EDITOR";

  private final ProjectNoteSpaceRepository projects;
  private final WikiSpaceRepository spaces;
  private final WikiSpaceMemberRepository members;
  private final WikiSpaceMemberGroupRepository groups;
  private final WikiPageRepository pages;
  private final WikiSpaceService spaceService;
  private final WikiPageService pageService;
  private final WikiPermissions perms;
  private final WikiShareLifecycle shareLifecycle;
  private final WikiChangeNotifier notifier;
  private final ApplicationEventPublisher publisher;

  // ── 프로젝트 변경 반영(리스너·백필) ──

  /**
   * 프로젝트 공간이 없으면 만든다(프로젝트 생성·백필). 지워졌거나 개인 프로젝트면 아무것도 하지 않는다. 이미 있으면 멤버만 맞춘다(멱등).
   *
   * <p>처음 만들 때: 이름 규칙({@link #resolveName})으로 TEAM 공간을 만들어 프로젝트에 잇고(owner_id = 프로젝트 소유자), 멤버를 맞춘 뒤
   * 맨 위 페이지 「리포트」를 하나 넣는다(작성자 = 프로젝트 소유자, 역할 검사 없는 내부 경로 — 백필 때 소유자가 이미 프로젝트를 떠났을 수 있다).
   *
   * @param actorId 변경 알림의 행위자(없으면 null — 백필)
   * @return 공간 id(만들지 않는 프로젝트면 empty)
   */
  @Transactional
  public Optional<Long> ensureSpace(long projectId, Long actorId) {
    Optional<ProjectInfo> found = projects.findProject(projectId).filter(ProjectInfo::hasSpace);
    if (found.isEmpty()) {
      return Optional.empty();
    }
    ProjectInfo project = found.get();
    // 같은 프로젝트의 맞추기·연결과 차례를 세운다 — 만들기와 겹쳐 공간이 둘 생기거나 멤버가 어긋나지 않게.
    projects.lockProject(projectId);
    Optional<Long> existing = spaces.findIdByLinkedProject(projectId);
    if (existing.isPresent()) {
      syncMembers(project, existing.get(), actorId);
      return existing;
    }
    long spaceId = spaces.insert("TEAM", resolveName(project.name(), null), project.ownerId());
    spaces.setLinkedProject(spaceId, projectId);
    syncMembers(project, spaceId, actorId);
    pageService.createWithoutRoleCheck(
        // 「리포트」 작성자 — 리포트·템플릿과 같은 규칙.
        projects.findReportAuthor(project.id(), project.ownerId()),
        spaceId,
        new CreatePageRequest(null, REPORT_TITLE));
    return Optional.of(spaceId);
  }

  /**
   * 프로젝트 멤버·멤버 부서가 바뀌었다 — 이 프로젝트에 이어진 공간이 있으면 멤버를 다시 맞춘다. 이벤트에는 역할이 없으므로 원하는 상태를 프로젝트 테이블에서 다시 읽는다.
   * 지워진 프로젝트·공간 없는 프로젝트는 아무것도 하지 않는다.
   */
  @Transactional
  public void reconcile(long projectId, Long actorId) {
    // 연결·다른 맞추기와 차례를 세운다 — 연결 중 들어온 멤버 변경이 옛 공간에만 반영되고 새 공간은 놓치지 않게(잠금 뒤 연결된 공간을 읽는다).
    projects.lockProject(projectId);
    Optional<Long> spaceId = spaces.findIdByLinkedProject(projectId);
    if (spaceId.isEmpty()) {
      return;
    }
    projects
        .findProject(projectId)
        .filter(ProjectInfo::hasSpace)
        .ifPresent(p -> syncMembers(p, spaceId.get(), actorId));
  }

  /**
   * 프로젝트 이름이 바뀌었다 — 이어진 공간 이름을 같은 규칙으로 다시 정한다. 이름이 바뀐 수정에서만 불린다(리스너가 nameChanged 로 거른다) — 설명·저장소만
   * 고친 수정이 사용자가 고른(연결한) 공간 이름을 덮지 않게. 지금 이름이 이미 새 이름의 규칙 꼴(「X」·「X 프로젝트」·「X 프로젝트 N」)이면 그대로 둔다.
   *
   * <p>연결한(사용자가 고른) 공간도 이름 변경은 따라간다 — 「따라가지 않음」을 표시할 플래그 없이 단순하게 두려는 선택이다. 연결하는 순간에는 이름을 바꾸지 않는다.
   */
  @Transactional
  public void onProjectRenamed(long projectId, Long actorId) {
    projects.lockProject(projectId);
    Optional<Long> spaceId = spaces.findIdByLinkedProject(projectId);
    Optional<ProjectInfo> project = projects.findProject(projectId);
    if (spaceId.isEmpty() || project.isEmpty()) {
      return;
    }
    long id = spaceId.get();
    String current = spaces.findName(id).orElse("");
    if (matchesNameFamily(current, normalize(project.get().name()))) {
      return;
    }
    spaces.rename(id, resolveName(project.get().name(), id));
    notifier.spaceChanged(id, actorId, List.of());
  }

  /**
   * 프로젝트가 지워졌다(soft delete) — 공간 연결을 끊어 일반 팀 공간으로 남긴다. 멤버는 그대로 둔다(이미 프로젝트 멤버뿐). 보관 기능은 프로젝트에 없어 삭제만
   * 다룬다.
   */
  @Transactional
  public void onProjectDeleted(long projectId, Long actorId) {
    projects.lockProject(projectId);
    spaces
        .findIdByLinkedProject(projectId)
        .ifPresent(
            id -> {
              spaces.setLinkedProject(id, null);
              notifier.spaceChanged(id, actorId, List.of());
            });
  }

  // ── 조회·연결 API ──

  /** 프로젝트의 노트 공간 요약. 공간 멤버(= 프로젝트 멤버)만 볼 수 있고, 아니면(공간이 없어도) 404 — 존재를 드러내지 않는다. */
  @Transactional(readOnly = true)
  public WikiProjectSpaceResponse get(long callerId, String projectKey) {
    ProjectInfo project = requireSpaceProject(projectKey);
    long spaceId =
        spaces
            .findIdByLinkedProject(project.id())
            .orElseThrow(() -> new WikiSpaceNotFoundException(0));
    return spaces
        .findForUser(spaceId, callerId)
        .map(s -> new WikiProjectSpaceResponse(s.id(), s.name(), project.key()))
        .orElseThrow(() -> new WikiSpaceNotFoundException(spaceId));
  }

  /**
   * 기존 팀 공간을 프로젝트 노트 공간으로 연결한다. 조건: 호출자가 프로젝트 OWNER(직접 멤버 행) 이고 대상 공간의 OWNER, 대상은 프로젝트에 이어지지 않은
   * TEAM 공간.
   *
   * <p>처리 순서(프로젝트당 연결 공간 하나라는 부분 유일 인덱스 때문에 순서가 중요하다):
   *
   * <ol>
   *   <li>자동 공간의 맨 위 「리포트」(하위 포함)를 대상 공간 맨 위 첫 자리로 옮긴다 — 기존 노트 옮기기 경로(공유·알림·연결 재검증 포함)
   *   <li>자동 공간 연결을 끊는다. 남은 페이지가 없으면 공간을 지우고(삭제 정리 경로 재사용), 있으면 일반 팀 공간으로 남긴다
   *   <li>대상 공간을 프로젝트에 잇고 멤버를 맞춘다 — 프로젝트 밖 사람은 빠진다. 대상 이름은 바꾸지 않는다
   * </ol>
   *
   * @throws WikiSpaceNotFoundException 프로젝트가 없거나 호출자가 프로젝트 멤버·대상 공간 멤버가 아님(404)
   * @throws WikiForbiddenException 프로젝트 OWNER 가 아니거나 대상 공간 OWNER 가 아님(403)
   * @throws WikiProjectSpaceConflictException 대상이 개인 공간이거나 이미 프로젝트에 이어진 공간(409)
   */
  @Transactional
  public WikiProjectSpaceResponse link(long callerId, String projectKey, long targetSpaceId) {
    ProjectInfo project = requireSpaceProject(projectKey);
    // 프로젝트 단위로 차례를 세운다 — 같은 프로젝트의 멤버 맞추기·다른 연결이 이 연결의 읽기-후-쓰기 사이에 끼지 않게.
    projects.lockProject(project.id());
    String projectRole =
        projects
            .findDirectRole(project.id(), callerId)
            .orElseThrow(() -> new WikiSpaceNotFoundException(0));
    if (!OWNER.equals(projectRole)) {
      throw new WikiForbiddenException("프로젝트 소유자만 노트 공간을 연결할 수 있습니다");
    }
    // 대상 공간 멤버가 아니면 404(존재 은닉), OWNER 가 아니면 403.
    perms.requireRole(targetSpaceId, callerId, OWNER);
    // 대상 공간 행을 잠근 뒤 검사한다 — 사람의 멤버 편집(가드가 FOR SHARE)과 다른 프로젝트의 동시 연결이 이 연결 뒤로 선다.
    spaces.lockForLink(targetSpaceId);
    String type =
        spaces
            .findType(targetSpaceId)
            .orElseThrow(() -> new WikiSpaceNotFoundException(targetSpaceId));
    if (!"TEAM".equals(type)) {
      throw new WikiProjectSpaceConflictException("개인 노트 공간은 프로젝트에 연결할 수 없습니다");
    }
    if (spaces.findLinkedProjectId(targetSpaceId).isPresent()) {
      throw new WikiProjectSpaceConflictException(ALREADY_LINKED);
    }
    spaces
        .findIdByLinkedProject(project.id())
        .ifPresent(autoId -> retireAutoSpace(callerId, autoId, targetSpaceId));
    // 조건부 갱신 — 잠금으로 이미 막았지만, 연결되지 않은 공간만 잇는다는 규칙을 쓰기 자체에도 둔다.
    if (spaces.linkIfUnlinked(targetSpaceId, project.id()) == 0) {
      throw new WikiProjectSpaceConflictException(ALREADY_LINKED);
    }
    syncMembers(project, targetSpaceId, callerId);
    // 이름·멤버가 그대로여도 projectKey 가 생겼다 — 목록·멤버 창이 프로젝트 공간으로 다시 그리게 알린다.
    notifier.spaceChanged(targetSpaceId, callerId, List.of());
    String name = spaces.findName(targetSpaceId).orElse("");
    return new WikiProjectSpaceResponse(targetSpaceId, name, project.key());
  }

  /** 연결로 물러나는 자동 공간 정리 — 「리포트」를 대상으로 옮기고 연결을 끊은 뒤, 비었으면 지운다(아래 link 주석의 1·2단계). */
  private void retireAutoSpace(long callerId, long autoId, long targetSpaceId) {
    findRootPage(autoId, REPORT_TITLE)
        .ifPresent(
            pageId ->
                pageService.move(callerId, pageId, new MovePageRequest(null, 0, targetSpaceId)));
    spaces.setLinkedProject(autoId, null);
    if (pages.listBySpace(autoId).isEmpty()) {
      spaceService.deleteSpace(callerId, autoId);
    } else {
      notifier.spaceChanged(autoId, callerId, List.of());
    }
  }

  /**
   * 공간 맨 위 페이지 중 제목이 title 인 것(여럿이면 먼저 만든 것). 지웠거나 이름을 바꿨으면 empty — 연결 때는 옮길 것이 없고, 리포트 생성(WP-1483
   * 「리포트」, WP-1486 「보고」)은 {@link #ensureRootPage} 로 새로 만든다.
   */
  Optional<Long> findRootPage(long spaceId, String title) {
    List<Long> roots = pages.childIdsOrdered(spaceId, null);
    Map<Long, String> titles = pages.findTitles(roots);
    return roots.stream().filter(id -> title.equals(titles.get(id))).min(Long::compare);
  }

  /**
   * 공간의 맨 위 페이지 title(「리포트」·「보고」) id — 없으면(사람이 지웠거나 이름을 바꿨으면) 맨 위 첫 자리에 새로 만든다(WP-1483, WP-1486 에서
   * 제목 인자로 일반화). 작성자는 부르는 쪽이 정한 사람(리포트 작성자 규칙 OWNER, 개인 보고는 본인)이고 역할 검사는 하지 않는다 — 실행기에는 사용자 세션이 없다.
   * 같은 패키지의 {@link WikiSystemPageWriter} 만 부른다.
   */
  @Transactional
  long ensureRootPage(long spaceId, String title, long authorId) {
    // 같은 공간 트리 잠금으로 동시 생성이 같은 제목 페이지를 둘 만들지 않게 한다(잠근 뒤 다시 찾는다).
    pages.lockSpaceTree(spaceId);
    Optional<Long> found = findRootPage(spaceId, title);
    if (found.isPresent()) {
      return found.get();
    }
    long id =
        pageService
            .createWithoutRoleCheck(authorId, spaceId, new CreatePageRequest(null, title))
            .id();
    // 새로 만든 페이지는 맨 끝 — 처음 공간을 만들 때처럼 맨 위 첫 자리로 올린다.
    pageService.moveAsSystem(authorId, id, null, 0);
    return id;
  }

  /** key 로 공간을 둘 수 있는(지워지지 않은 TEAM·OPEN) 프로젝트를 찾는다. 없으면 404. */
  private ProjectInfo requireSpaceProject(String projectKey) {
    return projects
        .findActiveByKey(projectKey)
        .filter(ProjectInfo::hasSpace)
        .orElseThrow(() -> new WikiSpaceNotFoundException(0));
  }

  // ── 멤버 맞추기 ──

  /**
   * 공간 멤버를 프로젝트에 맞춘다 — 원하는 상태와 지금 상태를 각각 한 번씩 읽어 차이만 반영한다(조회 수가 인원 수에 따라 늘지 않게 — 부서 하나로 수백 명이 오가도,
   * WP-1129 와 같은 이유). 부서로 들어오는 사람은 부서 행으로 다루므로 사람 단위로 손대지 않는다.
   *
   * <p>부수효과는 노트 앱의 수동 멤버 변경과 같다: 편집 권한을 잃은 사람이 만든 공유 해제, 공간 변경 알림(빠진 사람에게도), 커밋 뒤 열린 편집 연결 재검증. 공유
   * 해제는 직접 부른다 — 이 메서드가 커밋 직전 리스너 안(프로젝트의 조직도 변경 정리)에서 돌 수도 있어 커밋 직전 이벤트로 미루면 돌지 않을 수 있다.
   */
  private void syncMembers(ProjectInfo project, long spaceId, Long actorId) {
    Map<Long, String> wantPeople = new HashMap<>();
    projects
        .findDirectMemberRoles(project.id())
        .forEach((userId, role) -> wantPeople.put(userId, OWNER.equals(role) ? OWNER : EDITOR));
    Set<Long> wantGroups = new LinkedHashSet<>(projects.findDepartmentGroupIds(project.id()));
    Map<Long, String> havePeople = members.findDirectRoles(spaceId);
    Map<Long, String> haveGroups = groups.findRoles(spaceId);

    // 부서 먼저 — 사람을 뺄 때 공유 해제 판정이 바뀐 부서 행을 보게.
    List<Long> groupsToRemove =
        haveGroups.keySet().stream().filter(g -> !wantGroups.contains(g)).toList();
    List<Long> groupsToUpsert =
        wantGroups.stream().filter(g -> !EDITOR.equals(haveGroups.get(g))).toList();
    List<Long> peopleToRemove =
        havePeople.keySet().stream().filter(u -> !wantPeople.containsKey(u)).toList();
    List<Long> peopleToSet =
        wantPeople.entrySet().stream()
            .filter(e -> !e.getValue().equals(havePeople.get(e.getKey())))
            .map(Map.Entry::getKey)
            .toList();
    if (groupsToRemove.isEmpty()
        && groupsToUpsert.isEmpty()
        && peopleToRemove.isEmpty()
        && peopleToSet.isEmpty()) {
      return;
    }

    // 부서를 빼면 그 부서로만 들어오던 사람이 커밋 뒤 명단에서 빠진다 — 지금 명단을 추가 수신자로 모아 둔다.
    Set<Long> extraRecipients = new LinkedHashSet<>(peopleToRemove);
    if (!groupsToRemove.isEmpty()) {
      extraRecipients.addAll(members.memberUserIds(spaceId));
    }
    groupsToRemove.forEach(g -> groups.remove(spaceId, g));
    groupsToUpsert.forEach(g -> groups.upsert(spaceId, g, EDITOR, null));
    peopleToSet.forEach(u -> members.add(spaceId, u, wantPeople.get(u)));
    peopleToRemove.forEach(u -> members.remove(spaceId, u));

    // 편집 권한을 잃은 사람(직접 행 제거·부서 제거)이 만든 공유를 해제한다 — 공유를 만든 사람 쪽에서 한 번에 다시 판정한다.
    shareLifecycle.revokeSharesOfCreatorsWithoutEdit(spaceId);
    notifier.spaceChanged(spaceId, actorId, extraRecipients);
    // 테넌트는 지금 담는다 — 재검증 리스너는 커밋 뒤 다른 스레드에서 돈다.
    // 컨텍스트가 비어 있는 경로(발행한 쪽이 GUC 만 세운 내부 작업 등)도 있어 공간 행의 테넌트를 쓴다 — 늘 맞는 값이다.
    long tenantId = spaces.findTenantId(spaceId).orElseGet(TenantContext::require);
    Instant now = Instant.now();
    List<Long> changedPeople = new ArrayList<>(peopleToSet);
    changedPeople.addAll(peopleToRemove);
    changedPeople.forEach(
        u ->
            publisher.publishEvent(new WikiSpaceMembershipChangedEvent(tenantId, spaceId, u, now)));
    if (!groupsToRemove.isEmpty() || !groupsToUpsert.isEmpty()) {
      publisher.publishEvent(new WikiSpaceAudienceChangedEvent(tenantId, List.of(spaceId)));
    }
    log.debug(
        "프로젝트 노트 공간 멤버 맞춤 project={} space={} 사람 +{} -{} 부서 +{} -{}",
        project.id(),
        spaceId,
        peopleToSet.size(),
        peopleToRemove.size(),
        groupsToUpsert.size(),
        groupsToRemove.size());
  }

  // ── 이름 규칙 ──

  /**
   * 프로젝트 공간 이름을 정한다 — 프로젝트 이름을 쓰되, 테넌트 안의 다른 TEAM 공간(자기 자신 제외)과 겹치면 「X 프로젝트」, 그것도 겹치면 「X 프로젝트 2」, 3
   * … . 후보마다 이름 잠금(팀 공간 만들기와 같은 advisory lock)을 잡은 뒤 검사해 동시 생성·이름 변경이 같은 이름을 받지 않게 한다.
   */
  private String resolveName(String projectName, Long selfId) {
    String base = normalize(projectName);
    for (int n = 1; ; n++) {
      String candidate = candidate(base, n);
      spaces.lockTeamSpaceName(candidate);
      if (!spaces.existsTeamSpaceName(candidate, selfId)) {
        return candidate;
      }
    }
  }

  /** n 번째 후보 — 1: 「X」, 2: 「X 프로젝트」, 3 이상: 「X 프로젝트 (n-1)」. */
  private static String candidate(String base, int n) {
    if (n == 1) return base;
    if (n == 2) return base + NAME_SUFFIX;
    return base + NAME_SUFFIX + " " + (n - 1);
  }

  /**
   * 이름이 base 의 규칙 꼴(「X」·「X 프로젝트」·「X 프로젝트 N」)인지 — 대소문자를 구분한다. 「Alpha」→「ALPHA」 처럼 대소문자만 바꾼 이름 변경도 공간
   * 이름에 반영하려는 것이다(중복 판정은 대소문자를 무시하지만, 자기 자신은 빼고 보므로 대소문자만 다른 자기 이름으로는 바꿀 수 있다). 앞뒤 공백만 무시한다.
   */
  private static boolean matchesNameFamily(String name, String base) {
    String n = name.strip();
    return n.equals(base)
        || n.equals(base + NAME_SUFFIX)
        || n.matches(Pattern.quote(base + NAME_SUFFIX + " ") + "[0-9]+");
  }

  /** 팀 공간 만들기와 같은 정규화 — 앞뒤 공백을 다듬고 NFC 로 맞춘다(WP-562). */
  private static String normalize(String name) {
    return UnicodeNames.toNfc(name.strip());
  }
}
