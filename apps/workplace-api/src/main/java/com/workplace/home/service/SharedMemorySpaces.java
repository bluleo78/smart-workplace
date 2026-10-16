package com.workplace.home.service;

import com.workplace.global.security.PermissionChecker;
import com.workplace.home.exception.SharedAiMemoryException;
import com.workplace.home.repository.SharedMemorySpaceRepository;
import com.workplace.home.repository.SharedMemorySpaceRepository.ProjectInfo;
import com.workplace.home.repository.SharedMemorySpaceRepository.ProjectWithRole;
import com.workplace.home.repository.SharedMemorySpaceRepository.WikiInfo;
import com.workplace.home.repository.SharedMemorySpaceRepository.WikiWithRole;
import com.workplace.home.service.SharedSpace.SpaceKey;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.wiki.repository.WikiSpaceMemberRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 공용 메모리 공간 권한 한 곳(WP-386 스펙 3절). 모든 경로(설정 API·주입·직접 요청·배경 추출)가 이 판정만 쓴다 — 요청마다 다시 보므로 구성원에서 빠지면 바로
 * 안 보이고 안 들어간다. 호출자 트랜잭션 안(테넌트 GUC)에서 부른다.
 *
 * <ul>
 *   <li>조직: 읽기 전원, 추가·관리 RBAC ADMIN.
 *   <li>프로젝트(TEAM·OPEN, 지워지지 않음): 읽기 ProjectAccessGuard.canRead, 추가 구성원(+관리 권한자), 관리 OWNER + ADMIN
 *       우회.
 *   <li>노트 스페이스(TEAM): 읽기 VIEWER+, 추가 EDITOR+, 관리 OWNER — ADMIN 우회 없음(WikiPermissions 와 같다).
 * </ul>
 */
@Service
@RequiredArgsConstructor
public class SharedMemorySpaces {

  /** 사람이 직접 추가·요청한 출처 — 본인 항목 판정에 쓴다. */
  public static final Set<String> USER_ORIGINS = Set.of("USER_ADDED", "USER_REQUESTED");

  /** AI 가 만든 출처 — 관리 권한자가 지우면 지운 기록에 남겨 같은 말이 다시 저장되지 않게 한다. */
  public static final Set<String> AI_ORIGINS = Set.of("AI_EXTRACTED", "AI_CLEANED");

  /**
   * AI 소유(AI 가 고칠 수 있는) 항목인가 — AI 출처이면서 사람이 손대지 않은 것(updated_by 없음). 사람이 고친 AI 항목은 사람 항목처럼 지킨다. AI
   * 의 쓰기·되돌림으로 복원된 AI 문장은 updated_by 를 비워 다시 AI 소유가 된다. AI 편집 대상 판정(OpApplier)과 ai-agent 에 알리는
   * 출처(Participant)가 이 한 곳을 쓴다.
   */
  public static boolean aiOwned(String origin, Long updatedBy) {
    return AI_ORIGINS.contains(origin) && updatedBy == null;
  }

  /**
   * 항목을 걷어 낼 때(지우기·추가 되돌리기) 지운 기록에 남겨야 하는 출처인가 — AI 항목과 대화로 요청한 항목(USER_REQUESTED). 둘 다 대화 발화가 근거라
   * 배경 추출이 같은 발화에서 되살릴 수 있다. 화면에서 직접 추가한 항목(USER_ADDED)은 발화가 없어 남기지 않는다.
   */
  public static boolean rememberOnRemoval(String origin) {
    return AI_ORIGINS.contains(origin) || "USER_REQUESTED".equals(origin);
  }

  private static final Map<String, Integer> WIKI_RANK =
      Map.of("VIEWER", 1, "EDITOR", 2, "OWNER", 3);

  private final SharedMemorySpaceRepository repo;
  private final ProjectAccessGuard projectAccess;
  private final ProjectMemberRepository projectMembers;
  private final WikiSpaceMemberRepository wikiMembers;
  private final PermissionChecker permissions;

  /** 한 공간에 대한 사용자 권한. */
  public record Access(SharedSpace space, boolean canRead, boolean canAdd, boolean canManage) {}

  /** 공간 권한 — 공용 메모리 대상이 아닌 공간(없음·지워짐·PERSONAL)은 empty. */
  public Optional<Access> access(long userId, SpaceKey key) {
    if (key == null) return Optional.empty();
    return switch (key.type()) {
      case "ORG" -> {
        boolean admin = isAdmin(userId);
        yield Optional.of(new Access(SharedSpace.org(), true, admin, admin));
      }
      case "PROJECT" -> repo.project(key.id()).flatMap(p -> projectAccess(userId, p));
      case "WIKI_SPACE" -> repo.wiki(key.id()).flatMap(w -> wikiAccess(userId, w));
      default -> Optional.empty();
    };
  }

  /** 읽을 수 있는 공간의 권한 — 없거나 못 읽으면 404(존재 숨김). */
  public Access requireReadable(long userId, SpaceKey key) {
    return access(userId, key)
        .filter(Access::canRead)
        .orElseThrow(SharedAiMemoryException::notFound);
  }

  /**
   * 읽을 수 있는 공간 전부 — 조직 → 프로젝트(이름순) → 노트 스페이스(이름순). 목록 쿼리가 읽기 규칙을 이미 적용하고 역할도 함께 읽어 오므로 공간마다 다시 조회하지
   * 않는다(규칙은 단일 공간 판정과 같은 projectRule·wikiRule).
   */
  public List<Access> readable(long userId) {
    boolean admin = isAdmin(userId);
    List<Access> out = new ArrayList<>();
    out.add(new Access(SharedSpace.org(), true, admin, admin));
    for (ProjectWithRole p : repo.readableProjects(userId, admin)) {
      projectRule(p.project(), true, p.role(), admin).filter(Access::canRead).ifPresent(out::add);
    }
    for (WikiWithRole w : repo.teamWikis(userId)) {
      wikiRule(w.wiki(), w.role()).filter(Access::canRead).ifPresent(out::add);
    }
    return out;
  }

  /**
   * 사용자 메시지의 화면 공간 검증(스펙 6.1) — 클라이언트 값을 믿지 않는다. 프로젝트는 키로 찾아 TEAM·OPEN 이고 읽을 수 있어야, 스페이스는 id 로 찾아
   * TEAM 이고 구성원이어야 한다. 그 밖(조직·모르는 종류·위조)은 empty. 요청 스레드는 트랜잭션 없이 부르므로 읽기 전용 트랜잭션을 달았다(이미 있으면 합류).
   */
  @Transactional(readOnly = true)
  public Optional<SharedSpace> verifyForMessage(
      long userId, String type, String projectKey, Long spaceId) {
    if ("PROJECT".equals(type) && projectKey != null && !projectKey.isBlank()) {
      return repo.projectByKey(projectKey.strip())
          .flatMap(p -> projectAccess(userId, p))
          .filter(Access::canRead)
          .map(Access::space);
    }
    if ("WIKI_SPACE".equals(type) && spaceId != null) {
      return repo.wiki(spaceId)
          .flatMap(w -> wikiAccess(userId, w))
          .filter(Access::canRead)
          .map(Access::space);
    }
    return Optional.empty();
  }

  /** 행 하나를 고치고 지울 수 있는가 — 관리 권한자, 또는 본인이 직접 추가·요청한 항목(지금도 추가 권한이 있을 때). */
  public boolean canEdit(Access a, long userId, String origin, Long authorUserId) {
    if (a.canManage()) return true;
    return a.canAdd() && USER_ORIGINS.contains(origin) && Objects.equals(authorUserId, userId);
  }

  /** 단일 프로젝트 판정 — 읽기·구성원 역할·ADMIN 을 조회해 projectRule 에 넘긴다. */
  private Optional<Access> projectAccess(long userId, ProjectInfo p) {
    if (!isSharedProjectType(p)) return Optional.empty();
    boolean read = projectAccess.canRead(p.id(), userId);
    String role = projectMembers.find(p.id(), userId).map(m -> m.role()).orElse(null);
    return projectRule(p, read, role, isAdmin(userId));
  }

  /** 프로젝트 권한 규칙 한 곳 — (공간, 읽기 여부, 구성원 역할, ADMIN) 만으로 판정한다. 추가는 구성원, 관리는 OWNER + ADMIN 우회. */
  private static Optional<Access> projectRule(
      ProjectInfo p, boolean read, String role, boolean admin) {
    if (!isSharedProjectType(p)) return Optional.empty();
    SharedSpace space = new SharedSpace(SharedSpace.Type.PROJECT, p.id(), p.key(), p.name());
    boolean manage = "OWNER".equals(role) || admin;
    boolean add = role != null || manage;
    return Optional.of(new Access(space, read, add && read, manage && read));
  }

  private static boolean isSharedProjectType(ProjectInfo p) {
    return "TEAM".equals(p.type()) || "OPEN".equals(p.type());
  }

  /** 단일 노트 스페이스 판정 — 스페이스 역할을 조회해 wikiRule 에 넘긴다. */
  private Optional<Access> wikiAccess(long userId, WikiInfo w) {
    return wikiRule(w, wikiMembers.findRole(w.id(), userId).orElse(null));
  }

  /** 노트 스페이스 권한 규칙 한 곳 — 역할 서열(VIEWER 1 < EDITOR 2 < OWNER 3)로 읽기·추가·관리를 가른다. TEAM 만 대상. */
  private static Optional<Access> wikiRule(WikiInfo w, String role) {
    if (!"TEAM".equals(w.type())) return Optional.empty();
    SharedSpace space = new SharedSpace(SharedSpace.Type.WIKI_SPACE, w.id(), null, w.name());
    int rank = role == null ? 0 : WIKI_RANK.getOrDefault(role, 0);
    return Optional.of(new Access(space, rank >= 1, rank >= 2, rank >= 3));
  }

  private boolean isAdmin(long userId) {
    return permissions.userHasRole(userId, "ADMIN");
  }
}
