package com.workplace.user.service;

import com.workplace.global.security.PermissionChecker;
import com.workplace.global.tenant.TenantContext;
import com.workplace.user.dto.AddMemberRequest;
import com.workplace.user.dto.CreateUserGroupRequest;
import com.workplace.user.dto.UpdateUserGroupRequest;
import com.workplace.user.dto.UserGroupDetail;
import com.workplace.user.dto.UserGroupMemberHit;
import com.workplace.user.dto.UserGroupNode;
import com.workplace.user.dto.UserGroupTreeResponse;
import com.workplace.user.exception.InvalidUserGroupException;
import com.workplace.user.exception.UserGroupForbiddenException;
import com.workplace.user.exception.UserGroupNotFoundException;
import com.workplace.user.outbound.DepartmentMembersReduced;
import com.workplace.user.repository.UserGroupRepository;
import com.workplace.user.repository.UserGroupRepository.FlatGroup;
import com.workplace.user.repository.UserGroupRepository.GroupMemberRow;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 사용자 그룹·조직도 유스케이스. 트리는 평면 fetch 후 Java 조립. 격리는 requireWritable 3-분기 idiom: 미존재→404, PERSONAL
 * 비소유자→404(존재 은닉), SHARED 비-manage→403. SHARED 쓰기는 user-group:manage 권한 필요.
 */
@Service
@RequiredArgsConstructor
public class UserGroupService {
  private static final String MANAGE = "user-group:manage";

  private final UserGroupRepository repo;
  private final PermissionChecker permissionChecker;
  private final ApplicationEventPublisher publisher;

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
    return toDetail(callerId, requireReadable(callerId, id));
  }

  /** 볼 수 있는 그룹을 읽는다 — 남의 개인 그룹은 관리자가 아니면 없는 것처럼 404(존재 은닉). */
  private FlatGroup requireReadable(long callerId, long id) {
    FlatGroup g = repo.findById(id).orElseThrow(() -> new UserGroupNotFoundException(id));
    if ("PERSONAL".equals(g.visibility())
        && (g.ownerId() == null || g.ownerId() != callerId)
        && !permissionChecker.userHasRole(callerId, "ADMIN")) {
      throw new UserGroupNotFoundException(id); // 존재 은닉
    }
    return g;
  }

  /**
   * 그룹과 그 하위 조직 전체에서 구성원을 찾는다(WP-1000) — 상위 조직(경영지원본부)에서 검색해도 하위 팀(재경팀) 사람이 나오게. 대소문자 무시 부분 일치로 DB
   * 에서 거르고(빈 검색어면 모두), 비교 대상은 내부 구성원이 이름·이메일·직책, 외부 연락처는 거기에 조직까지다(구성원에는 조직 열이 없다). 한 사람이 여러 하위 조직에
   * 있으면 찾은 그룹에 가장 가까운(얕은) 소속 하나만, 그 소속까지의 경로와 함께 돌려준다. 이름 오름차순.
   */
  @Transactional(readOnly = true)
  public List<UserGroupMemberHit> searchMembers(long callerId, long id, String q) {
    FlatGroup root = requireReadable(callerId, id);
    Map<Long, FlatGroup> byId = new HashMap<>();
    for (FlatGroup g : repo.findAccessible(treeOwner(root, callerId))) {
      byId.put(g.id(), g);
    }
    // 그룹 id → 가까운 순번(작을수록 찾은 그룹에 가까운 소속). 키는 찾을 범위다.
    Map<Long, Integer> depthRank = subtreeRanks(id);
    Map<String, GroupMemberRow> nearest = new LinkedHashMap<>();
    for (GroupMemberRow r :
        repo.findMembersIn(
            TenantContext.require(),
            callerId,
            permissionChecker.userHasRole(callerId, "ADMIN"),
            depthRank.keySet(),
            q == null ? null : q.trim())) {
      // 이름순으로 온 행에서 같은 사람은 찾은 그룹에 가까운 소속을 남긴다(자리는 처음 본 곳 그대로 — 이름순 유지).
      nearest.merge(
          r.member().targetType() + ":" + r.member().targetId(),
          r,
          (a, b) -> depthRank.get(b.groupId()) < depthRank.get(a.groupId()) ? b : a);
    }
    return nearest.values().stream()
        .map(r -> UserGroupMemberHit.of(r.groupId(), pathFrom(byId, id, r.groupId()), r.member()))
        .toList();
  }

  /** 찾은 그룹(fromId)부터 속한 그룹까지의 이름 — 직속이면 빈 목록. 부모를 따라 올라가 뒤집는다. */
  private static List<String> pathFrom(Map<Long, FlatGroup> byId, long fromId, long groupId) {
    if (groupId == fromId) {
      return List.of();
    }
    Deque<String> names = new ArrayDeque<>();
    for (FlatGroup g = byId.get(groupId); g != null; g = byId.get(g.parentId())) {
      names.push(g.name());
      if (g.id() == fromId) {
        break;
      }
    }
    return List.copyOf(names);
  }

  /**
   * 그룹의 하위를 볼 트리의 주인 — 개인 그룹이면 그 주인, 공유 그룹이면 호출자. 하위 조직 검색이 소속 경로 이름을 그릴 그룹 목록을 읽을 때 쓴다 — 관리자가 남의
   * 개인 그룹을 검색할 때도 주인 트리로 봐야 경로가 끊기지 않는다(WP-677). 검색 범위(자손) 자체는 {@link
   * UserGroupRepository#findSubtreeIds} 가 정한다.
   */
  private static long treeOwner(FlatGroup g, long callerId) {
    return g.ownerId() != null ? g.ownerId() : callerId;
  }

  /**
   * id 그룹과 자손의 가까운 순번(자기 0 — 작을수록 가까운 소속, 깊이 순). 순서를 지키는 맵이다. 트리 탐색은 공통 규칙(WP-1055, {@link
   * UserGroupRepository#findSubtreeIds})이다.
   */
  private Map<Long, Integer> subtreeRanks(long id) {
    Map<Long, Integer> ranks = new LinkedHashMap<>();
    for (Long g : repo.findSubtreeIds(id)) { // 출발 그룹이 하나라 그룹마다 한 번씩 온다
      ranks.put(g, ranks.size());
    }
    return ranks;
  }

  /**
   * 공유 그룹 코드 중복 사전 확인(WP-549). 코드 유니크 인덱스(테넌트·SHARED 한정)에 걸리면 무결성 위반 일반 처리로 영어 409 가 나가므로, 저장 전에 같은
   * 코드의 다른 공유 그룹이 있는지 보고 한국어 안내로 거절한다. 개인 그룹·빈 코드는 제약이 없어 확인하지 않는다.
   */
  private void requireUniqueCode(String visibility, String code, Long excludeId) {
    if ("SHARED".equals(visibility)
        && code != null
        && !code.isBlank()
        && repo.existsSharedCode(code, excludeId)) {
      throw new InvalidUserGroupException("이미 존재하는 그룹 코드입니다: " + code);
    }
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
      validateParent(ownerId, req.visibility(), req.parentId());
    }
    if (repo.existsSiblingName(req.parentId(), req.visibility(), ownerId, req.name(), null)) {
      throw new InvalidUserGroupException("이미 존재하는 그룹 이름입니다: " + req.name());
    }
    requireUniqueCode(req.visibility(), req.code(), null);
    long id = repo.insert(req, ownerId);
    return toDetail(
        callerId, repo.findById(id).orElseThrow(() -> new UserGroupNotFoundException(id)));
  }

  /**
   * 그룹 부분 수정(#839). null 필드는 현재 값을 유지하고, moveToRoot/clearCode 플래그로만 최상위 이동·코드 비우기를 한다. 현재 행과 한
   * 트랜잭션에서 병합한 뒤, 사이클·부모 검증과 형제 이름 유니크 검사는 **병합 후 값**으로 한다 — 이름만 바꾸는 요청도 현재 부모 기준으로 중복을 본다.
   */
  @Transactional
  public UserGroupDetail update(long callerId, long id, UpdateUserGroupRequest req) {
    boolean moveToRoot = Boolean.TRUE.equals(req.moveToRoot());
    boolean clearCode = Boolean.TRUE.equals(req.clearCode());
    // 값과 "비우기" 플래그를 함께 주면 의도가 모호하다 — 추측하지 않고 거절한다.
    if (moveToRoot && req.parentId() != null) {
      throw new InvalidUserGroupException("parentId 와 moveToRoot 는 함께 지정할 수 없습니다");
    }
    if (clearCode && req.code() != null) {
      throw new InvalidUserGroupException("code 와 clearCode 는 함께 지정할 수 없습니다");
    }
    // 부모를 새로 지정하면 같은 테넌트의 다른 이동과 한 줄로 세운다(WP-790) — 순환 검사를 다른 이동이 커밋한 뒤의 트리로 하게, 그룹 행을 읽기 전에 잠근다.
    if (req.parentId() != null) {
      repo.lockMoves(TenantContext.require());
    }
    FlatGroup g = requireWritable(callerId, id);
    String name = req.name() != null ? req.name() : g.name();
    Long parentId = moveToRoot ? null : (req.parentId() != null ? req.parentId() : g.parentId());
    String code = clearCode ? null : (req.code() != null ? req.code() : g.code());
    int sortOrder = req.sortOrder() != null ? req.sortOrder() : g.sortOrder();

    // 부모를 새로 지정할 때만 사이클·부모 검증 — 유지되는 부모는 이미 검증된 상태다.
    if (req.parentId() != null) {
      if (req.parentId() == id) {
        throw new InvalidUserGroupException("그룹을 자기 자신의 하위로 옮길 수 없습니다");
      }
      // 자손·부모는 호출자가 아니라 이 그룹 기준으로 본다(WP-677) — 관리자가 남의 개인 그룹을 옮길 때 관리자 트리로 보면 그 자손이 없어
      // 순환을 놓쳤고, 「부모 주인 == 호출자」만 봐 남의 그룹을 관리자 개인 그룹 밑으로 옮겨 양쪽 트리에서 사라지게 했다. 자손은 이 그룹의 트리를
      // DB 에서 따라가 구하고(호출자와 무관), 부모는 이 그룹 주인으로 검증한다.
      if (repo.findSubtreeIds(id).contains(req.parentId())) {
        throw new InvalidUserGroupException("그룹을 자손 그룹의 하위로 옮길 수 없습니다");
      }
      validateParent(g.ownerId(), g.visibility(), req.parentId());
    }
    if (repo.existsSiblingName(parentId, g.visibility(), g.ownerId(), name, id)) {
      throw new InvalidUserGroupException("이미 존재하는 그룹 이름입니다: " + name);
    }
    requireUniqueCode(g.visibility(), code, id);
    // 다른 상위 부서 아래로 옮기면(최상위로 포함) 옛 상위 부서의 구성원이 줄어든다 — 노트 부서 공유가 열린 화면을 다시 판정하게 알린다(WP-1042).
    if (!Objects.equals(parentId, g.parentId())) {
      publishMembersReduced(g, ancestorIds(g.parentId()));
    }
    repo.update(id, name, parentId, code, sortOrder);
    return toDetail(
        callerId, repo.findById(id).orElseThrow(() -> new UserGroupNotFoundException(id)));
  }

  /** 그룹 삭제(서브트리·멤버십 캐스케이드). */
  @Transactional
  public void delete(long callerId, long id) {
    FlatGroup g = requireWritable(callerId, id);
    // 지울 부서·하위 부서와 그 상위 부서의 구성원이 줄어든다. 부서를 대상으로 한 공유 행은 지우면 사라지므로 지우기 전에 알린다(WP-1042).
    Set<Long> affected = new LinkedHashSet<>(ancestorIds(g.parentId()));
    affected.addAll(repo.findSubtreeIds(id));
    publishMembersReduced(g, affected);
    repo.delete(id);
  }

  /**
   * 그룹 삭제 사전검증(#839) — delete 와 같은 술어(requireWritable)를 쓰기 없이 수행한다. AI 확인 카드(user_group.delete) 생성
   * 전에 존재·권한 실패를 드러내 승인 시점에야 실패하는 카드를 만들지 않는다.
   *
   * @throws UserGroupNotFoundException 미존재 또는 PERSONAL 비소유자(존재 은닉)
   * @throws UserGroupForbiddenException SHARED 인데 user-group:manage 없음
   */
  @Transactional(readOnly = true)
  public void validateDeletable(long callerId, long id) {
    requireWritable(callerId, id);
  }

  /** 멤버 편입. 대상 검증 후 멱등 삽입. */
  @Transactional
  public UserGroupDetail addMember(long callerId, long id, AddMemberRequest req) {
    FlatGroup g = requireWritable(callerId, id);
    if ("MEMBER".equals(req.targetType())) {
      // 거절 이유를 갈라 안내한다(WP-553) — 정지된 사람을 「존재하지 않음」으로 안내하지 않고, 내부 id 도 붙이지 않는다.
      switch (repo.memberTarget(TenantContext.require(), req.targetId())) {
        case OK -> {}
        case SUSPENDED -> throw new InvalidUserGroupException("정지된 구성원은 그룹에 넣을 수 없습니다");
        case NOT_HUMAN -> throw new InvalidUserGroupException("AI 는 그룹에 넣을 수 없습니다");
        case NOT_MEMBER -> throw new InvalidUserGroupException("이 워크스페이스의 구성원이 아닙니다");
      }
    } else { // EXTERNAL
      boolean admin = permissionChecker.userHasRole(callerId, "ADMIN");
      if (!repo.externalReadable(callerId, admin, req.targetId())) {
        // 문구에 id 를 넣지 않는다 — 화면·AI 에 내부 번호가 보였다(WP-672 와 같은 부류, WP-677).
        throw new InvalidUserGroupException("접근할 수 없는 외부 연락처입니다");
      }
    }
    repo.addMember(id, req.targetType(), req.targetId());
    return toDetail(callerId, g);
  }

  /**
   * 멤버 제외. 대상 종류는 편입 요청과 같은 MEMBER·EXTERNAL 만 받는다(WP-551) — 경로 변수라 Bean Validation 을 거치지 않아,
   * 오타·소문자가 0행 삭제 204 로 끝나 호출한 쪽이 뺐다고 믿게 되던 것을 400 으로 거절한다. 이미 없는 멤버를 빼는 것은 멱등 204 그대로다.
   */
  @Transactional
  public void removeMember(long callerId, long id, String targetType, long targetId) {
    if (!"MEMBER".equals(targetType) && !"EXTERNAL".equals(targetType)) {
      throw new InvalidUserGroupException(
          "알 수 없는 대상 종류입니다: " + targetType + " (MEMBER 또는 EXTERNAL)");
    }
    FlatGroup g = requireWritable(callerId, id);
    if ("MEMBER".equals(targetType)) {
      // 뺀 부서와 그 상위 부서는 하위 부서 구성원까지 열린다 — 이 사람이 다른 소속이 없으면 부서 공유 접근을 잃는다(WP-1042).
      Set<Long> affected = new LinkedHashSet<>(ancestorIds(g.parentId()));
      affected.add(id);
      publishMembersReduced(g, affected);
    }
    repo.removeMember(id, targetType, targetId);
  }

  // --- 내부 헬퍼 ---

  /** parentId 부터 위로 올라가는 상위 부서 id(가까운 순) — 한 번의 조회(공통 규칙, WP-1055). 최상위(null)면 빈 목록. */
  private List<Long> ancestorIds(Long parentId) {
    return parentId == null ? List.of() : repo.findAncestorIds(parentId);
  }

  /** 조직도 부서(SHARED)의 구성원이 줄었음을 알린다 — 개인 그룹은 노트 공유 대상이 아니므로 알리지 않는다. */
  private void publishMembersReduced(FlatGroup g, Collection<Long> groupIds) {
    if (!"SHARED".equals(g.visibility()) || groupIds.isEmpty()) {
      return;
    }
    publisher.publishEvent(
        new DepartmentMembersReduced(TenantContext.require(), List.copyOf(groupIds)));
  }

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

  /**
   * 부모 검증 — 존재·동일 visibility, PERSONAL 은 부모 주인이 이 그룹 주인(ownerId)과 같아야 한다. 호출자가 아니라 그룹 주인과
   * 비교한다(WP-677) — 관리자는 남의 개인 그룹을 고칠 수 있지만, 다른 사람의 개인 그룹 밑에 두면 주인 트리에도 그 사람 트리에도 보이지 않는다. 문구에 id 를
   * 넣지 않는다(WP-672).
   */
  private void validateParent(Long ownerId, String visibility, long parentId) {
    FlatGroup parent =
        repo.findById(parentId).orElseThrow(() -> new InvalidUserGroupException("부모 그룹이 없습니다"));
    if (!parent.visibility().equals(visibility)) {
      throw new InvalidUserGroupException("부모 그룹의 공개 범위가 다릅니다");
    }
    if ("PERSONAL".equals(visibility)
        && (parent.ownerId() == null || !parent.ownerId().equals(ownerId))) {
      throw new InvalidUserGroupException("같은 사람의 개인 그룹 밑으로만 옮길 수 있습니다");
    }
  }

  /** 평면 목록에서 특정 visibility 의 트리(루트 리스트) 조립. sort_order→name 정렬. */
  private List<UserGroupNode> buildTree(List<FlatGroup> flat, String visibility) {
    List<FlatGroup> scoped = flat.stream().filter(g -> g.visibility().equals(visibility)).toList();
    Map<Long, List<FlatGroup>> childrenByParent = new LinkedHashMap<>();
    for (FlatGroup g : scoped) {
      childrenByParent.computeIfAbsent(g.parentId(), k -> new ArrayList<>()).add(g);
    }
    return buildNodes(childrenByParent, null);
  }

  /** childrenByParent 맵에서 parentId 하위 노드들을 재귀 조립(sort_order→name 정렬). */
  private List<UserGroupNode> buildNodes(
      Map<Long, List<FlatGroup>> childrenByParent, Long parentId) {
    List<FlatGroup> children = childrenByParent.getOrDefault(parentId, List.of());
    return children.stream()
        .sorted(
            Comparator.comparingInt(FlatGroup::sortOrder)
                .thenComparing(FlatGroup::name, String.CASE_INSENSITIVE_ORDER))
        .map(
            g ->
                new UserGroupNode(
                    g.id(),
                    g.code(),
                    g.name(),
                    g.parentId(),
                    g.ownerId(),
                    g.visibility(),
                    g.sortOrder(),
                    buildNodes(childrenByParent, g.id())))
        .toList();
  }

  /** FlatGroup → 상세(직속 멤버 포함). 외부 연락처 멤버는 호출자가 읽을 수 있는 것만(WP-547). */
  private UserGroupDetail toDetail(long callerId, FlatGroup g) {
    return new UserGroupDetail(
        g.id(),
        g.code(),
        g.name(),
        g.parentId(),
        g.ownerId(),
        g.visibility(),
        g.sortOrder(),
        repo.findMembers(
            TenantContext.require(),
            callerId,
            permissionChecker.userHasRole(callerId, "ADMIN"),
            g.id()));
  }
}
