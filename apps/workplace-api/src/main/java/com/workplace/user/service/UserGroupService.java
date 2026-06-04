package com.workplace.user.service;

import com.workplace.global.security.PermissionChecker;
import com.workplace.user.dto.AddMemberRequest;
import com.workplace.user.dto.CreateUserGroupRequest;
import com.workplace.user.dto.UpdateUserGroupRequest;
import com.workplace.user.dto.UserGroupDetail;
import com.workplace.user.dto.UserGroupNode;
import com.workplace.user.dto.UserGroupTreeResponse;
import com.workplace.user.exception.InvalidUserGroupException;
import com.workplace.user.exception.UserGroupForbiddenException;
import com.workplace.user.exception.UserGroupNotFoundException;
import com.workplace.user.repository.UserGroupRepository;
import com.workplace.user.repository.UserGroupRepository.FlatGroup;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 사용자 그룹·조직도 유스케이스. 트리는 평면 fetch 후 Java 조립. 격리는 requireWritable 3-분기 idiom:
 * 미존재→404, PERSONAL 비소유자→404(존재 은닉), SHARED 비-manage→403. SHARED 쓰기는 user-group:manage 권한 필요.
 */
@Service
@RequiredArgsConstructor
public class UserGroupService {
  private static final String MANAGE = "user-group:manage";

  private final UserGroupRepository repo;
  private final PermissionChecker permissionChecker;

  /** 공유 조직도 + 호출자 개인 그룹 트리. */
  @Transactional(readOnly = true)
  public UserGroupTreeResponse getTree(long callerId) {
    List<FlatGroup> flat = repo.findAccessible(callerId);
    List<UserGroupNode> shared = buildTree(flat, "SHARED");
    List<UserGroupNode> personal = buildTree(flat, "PERSONAL");
    return new UserGroupTreeResponse(shared, personal);
  }

  /** 그룹 상세 + 직속 멤버. PERSONAL 비소유자는 404. */
  @Transactional(readOnly = true)
  public UserGroupDetail getDetail(long callerId, long id) {
    FlatGroup g = repo.findById(id).orElseThrow(() -> new UserGroupNotFoundException(id));
    if ("PERSONAL".equals(g.visibility())
        && (g.ownerId() == null || g.ownerId() != callerId)
        && !permissionChecker.userHasRole(callerId, "ADMIN")) {
      throw new UserGroupNotFoundException(id); // 존재 은닉
    }
    return toDetail(g);
  }

  /** 그룹 생성. SHARED→manage 권한, PERSONAL→owner=caller. parent 검증 포함. */
  @Transactional
  public UserGroupDetail create(long callerId, CreateUserGroupRequest req) {
    boolean shared = "SHARED".equals(req.visibility());
    if (shared) {
      requireManage(callerId, 0L);
    }
    Long ownerId = shared ? null : callerId;
    if (req.parentId() != null) {
      validateParent(callerId, req.visibility(), req.parentId());
    }
    long id = repo.insert(req, ownerId);
    return toDetail(repo.findById(id).orElseThrow(() -> new UserGroupNotFoundException(id)));
  }

  /** 그룹 수정. requireWritable + 부모 사이클 방지. */
  @Transactional
  public UserGroupDetail update(long callerId, long id, UpdateUserGroupRequest req) {
    FlatGroup g = requireWritable(callerId, id);
    if (req.parentId() != null) {
      if (req.parentId() == id) {
        throw new InvalidUserGroupException("그룹을 자기 자신의 하위로 옮길 수 없습니다");
      }
      if (descendants(callerId, id).contains(req.parentId())) {
        throw new InvalidUserGroupException("그룹을 자손 그룹의 하위로 옮길 수 없습니다");
      }
      validateParent(callerId, g.visibility(), req.parentId());
    }
    repo.update(id, req);
    return toDetail(repo.findById(id).orElseThrow(() -> new UserGroupNotFoundException(id)));
  }

  /** 그룹 삭제(서브트리·멤버십 캐스케이드). */
  @Transactional
  public void delete(long callerId, long id) {
    requireWritable(callerId, id);
    repo.delete(id);
  }

  /** 멤버 편입. 대상 검증 후 멱등 삽입. */
  @Transactional
  public UserGroupDetail addMember(long callerId, long id, AddMemberRequest req) {
    FlatGroup g = requireWritable(callerId, id);
    if ("MEMBER".equals(req.targetType())) {
      if (!repo.memberUserExists(req.targetId())) {
        throw new InvalidUserGroupException("존재하지 않는 멤버입니다: " + req.targetId());
      }
    } else { // EXTERNAL
      boolean admin = permissionChecker.userHasRole(callerId, "ADMIN");
      if (!repo.externalReadable(callerId, admin, req.targetId())) {
        throw new InvalidUserGroupException("접근할 수 없는 외부 연락처입니다: " + req.targetId());
      }
    }
    repo.addMember(id, req.targetType(), req.targetId());
    return toDetail(g);
  }

  /** 멤버 제외. */
  @Transactional
  public void removeMember(long callerId, long id, String targetType, long targetId) {
    requireWritable(callerId, id);
    repo.removeMember(id, targetType, targetId);
  }

  // --- 내부 헬퍼 ---

  /** 쓰기 권한 판정 — 미존재→404, PERSONAL 비소유자(비-admin)→404, SHARED 비-manage(비-admin)→403. */
  private FlatGroup requireWritable(long callerId, long id) {
    FlatGroup g = repo.findById(id).orElseThrow(() -> new UserGroupNotFoundException(id));
    if (g.ownerId() != null && g.ownerId() == callerId) return g;
    if (permissionChecker.userHasRole(callerId, "ADMIN")) return g;
    if ("PERSONAL".equals(g.visibility())) {
      throw new UserGroupNotFoundException(id); // 존재 은닉
    }
    if (!permissionChecker.hasPermission(callerId, MANAGE)) {
      throw new UserGroupForbiddenException(id, callerId);
    }
    return g;
  }

  /** SHARED 생성용 manage 권한 체크(ADMIN 우회 허용). */
  private void requireManage(long callerId, long id) {
    if (permissionChecker.userHasRole(callerId, "ADMIN")) return;
    if (!permissionChecker.hasPermission(callerId, MANAGE)) {
      throw new UserGroupForbiddenException(id, callerId);
    }
  }

  /** 부모 검증 — 존재·접근가능·동일 visibility, PERSONAL 은 동일 owner. */
  private void validateParent(long callerId, String visibility, long parentId) {
    FlatGroup parent =
        repo.findById(parentId)
            .orElseThrow(() -> new InvalidUserGroupException("부모 그룹이 없습니다: " + parentId));
    if (!parent.visibility().equals(visibility)) {
      throw new InvalidUserGroupException("부모 그룹의 공개 범위가 다릅니다");
    }
    if ("PERSONAL".equals(visibility)
        && (parent.ownerId() == null || parent.ownerId() != callerId)) {
      throw new InvalidUserGroupException("본인 소유의 부모 그룹만 지정할 수 있습니다");
    }
  }

  /** id 그룹의 모든 자손 id 집합(접근 가능한 평면 트리 기준). */
  private Set<Long> descendants(long callerId, long id) {
    Map<Long, List<Long>> childrenByParent = new LinkedHashMap<>();
    for (FlatGroup g : repo.findAccessible(callerId)) {
      childrenByParent.computeIfAbsent(g.parentId(), k -> new ArrayList<>()).add(g.id());
    }
    Set<Long> result = new HashSet<>();
    Deque<Long> stack = new ArrayDeque<>();
    stack.push(id);
    while (!stack.isEmpty()) {
      Long cur = stack.pop();
      for (Long child : childrenByParent.getOrDefault(cur, List.of())) {
        if (result.add(child)) stack.push(child);
      }
    }
    return result;
  }

  /** 평면 목록에서 특정 visibility 의 트리(루트 리스트) 조립. sort_order→name 정렬. */
  private List<UserGroupNode> buildTree(List<FlatGroup> flat, String visibility) {
    List<FlatGroup> scoped =
        flat.stream().filter(g -> g.visibility().equals(visibility)).toList();
    Map<Long, List<FlatGroup>> childrenByParent = new LinkedHashMap<>();
    for (FlatGroup g : scoped) {
      childrenByParent.computeIfAbsent(g.parentId(), k -> new ArrayList<>()).add(g);
    }
    return buildNodes(childrenByParent, null);
  }

  /** childrenByParent 맵에서 parentId 하위 노드들을 재귀 조립(sort_order→name 정렬). */
  private List<UserGroupNode> buildNodes(Map<Long, List<FlatGroup>> childrenByParent, Long parentId) {
    List<FlatGroup> children = childrenByParent.getOrDefault(parentId, List.of());
    return children.stream()
        .sorted(
            Comparator.comparingInt(FlatGroup::sortOrder)
                .thenComparing(FlatGroup::name, String.CASE_INSENSITIVE_ORDER))
        .map(
            g ->
                new UserGroupNode(
                    g.id(), g.code(), g.name(), g.parentId(), g.ownerId(), g.visibility(),
                    g.sortOrder(), buildNodes(childrenByParent, g.id())))
        .toList();
  }

  /** FlatGroup → 상세(직속 멤버 포함). */
  private UserGroupDetail toDetail(FlatGroup g) {
    return new UserGroupDetail(
        g.id(), g.code(), g.name(), g.parentId(), g.ownerId(), g.visibility(), g.sortOrder(),
        repo.findMembers(g.id()));
  }
}
