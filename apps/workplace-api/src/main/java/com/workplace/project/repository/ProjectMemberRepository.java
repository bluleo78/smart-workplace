package com.workplace.project.repository;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static com.workplace.jooq.Tables.PROJECT_MEMBER_GROUP;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_GROUP_MEMBER;
import static org.jooq.impl.DSL.count;

import com.workplace.global.share.ProjectMembership;
import com.workplace.global.tenant.WorkspaceActive;
import com.workplace.jooq.tables.ProjectMember;
import com.workplace.project.dto.MemberResponse;
import com.workplace.project.dto.MemberRow;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.Record2;
import org.jooq.Table;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * project_member 테이블 리포지토리.
 *
 * <p>WP-1057 — 멤버 판정({@link #find}·{@link #findUserIdsByProject}·{@link #findMemberUserIds}·잠금 판정)은
 * <b>실효 멤버</b>(직접 멤버 행 + 멤버로 둔 조직도 부서의 활성 사람 구성원, 공용 {@link ProjectMembership})로 본다. 직접 멤버 행만 다뤄야
 * 하는 멤버 관리(제거·역할 변경 대상, 「이미 멤버」 판정, 마지막 소유자 보호)는 {@code Direct} 가 붙은 메서드와 소유자 집계를 쓴다.
 */
@Repository
@RequiredArgsConstructor
public class ProjectMemberRepository {

  private final DSLContext dsl;

  /** SELECT 결과 → MemberRow (USER JOIN 없음). */
  private MemberRow mapToRow(Record r) {
    OffsetDateTime created = r.get(PROJECT_MEMBER.CREATED_AT);
    return new MemberRow(
        r.get(PROJECT_MEMBER.PROJECT_ID),
        r.get(PROJECT_MEMBER.USER_ID),
        r.get(PROJECT_MEMBER.ROLE),
        created != null ? created.toInstant() : null);
  }

  /**
   * 특정 프로젝트의 단일 멤버 조회 — <b>실효</b> 멤버십(WP-1057). 직접 멤버 행이 있으면 그 역할, 없고 멤버로 둔 조직도 부서로 걸리면 MEMBER, 둘 다
   * 아니면 empty. 접근 가드·역할 판정이 쓴다. 추가 시각은 직접 행이 있을 때만 채운다.
   *
   * <p>모든 접근 가드가 매 요청 부르므로 한 문장으로 본다 — 실효 역할({@link ProjectMembership#effectiveRole})은 직접 행이 있으면 그
   * 역할로 끝나고(직접 역할은 부서의 MEMBER 보다 낮지 않다), 없을 때만 부서 판정(재귀 상위 부서 조회)을 한다.
   */
  public Optional<MemberRow> find(Long projectId, Long userId) {
    Field<OffsetDateTime> created =
        DSL.field(
            DSL.select(PROJECT_MEMBER.CREATED_AT)
                .from(PROJECT_MEMBER)
                .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId))
                .and(PROJECT_MEMBER.USER_ID.eq(userId)));
    Record2<String, OffsetDateTime> r =
        dsl.select(ProjectMembership.effectiveRole(DSL.val(projectId), DSL.val(userId)), created)
            .fetchOne();
    if (r == null || r.value1() == null) {
      return Optional.empty();
    }
    return Optional.of(
        new MemberRow(
            projectId, userId, r.value1(), r.value2() != null ? r.value2().toInstant() : null));
  }

  /**
   * 사람이 멤버로 둔 조직도 부서(하위 부서 포함)로 이 프로젝트에 걸리는가 — 직접 행은 보지 않는다(WP-1057). 프로젝트에 부서 행이 없으면 부서 행 조회가 곧바로
   * 비어 끝난다.
   */
  public boolean isMemberViaDepartment(Long projectId, Long userId) {
    return dsl.fetchExists(
        DSL.selectOne()
            .where(ProjectMembership.viaDepartment(DSL.val(projectId), DSL.val(userId))));
  }

  /** 직접 멤버 행 단건 조회(부서로 들어온 것은 보지 않는다) — 멤버 제거·역할 변경 대상 확인용. */
  public Optional<MemberRow> findDirect(Long projectId, Long userId) {
    return dsl.select(
            PROJECT_MEMBER.PROJECT_ID,
            PROJECT_MEMBER.USER_ID,
            PROJECT_MEMBER.ROLE,
            PROJECT_MEMBER.CREATED_AT)
        .from(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.USER_ID.eq(userId)))
        .fetchOptional(this::mapToRow);
  }

  /** USER JOIN 결과 → MemberResponse. findAllByProject / findMemberWithUser 공유. */
  private MemberResponse mapToMemberResponse(Record r) {
    OffsetDateTime created = r.get(PROJECT_MEMBER.CREATED_AT);
    return new MemberResponse(
        r.get(PROJECT_MEMBER.USER_ID),
        r.get(USER.USERNAME),
        r.get(USER.NAME),
        r.get(USER.KIND),
        r.get(PROJECT_MEMBER.ROLE),
        created != null ? created.toInstant() : null,
        r.get(MEMBER_ACTIVE),
        true);
  }

  /**
   * WP-417: 프로젝트 멤버의 active = 이 워크스페이스에서 활성({@link WorkspaceActive}) — 관리자의 「활성 상태」 끄기는 멤버십만 바꾸므로
   * 전역 값만 보면 정지된 구성원이 활성으로 보인다. 멤버십은 프로젝트의 테넌트로 붙인다.
   */
  private static final Field<Boolean> MEMBER_ACTIVE = WorkspaceActive.field();

  /**
   * 프로젝트의 <b>직접</b> 멤버 행 전체를 USER JOIN 하여 username/name/kind/active 포함된 응답으로 조회. created_at 오름차순.
   * 부서로 들어온 사람까지 보려면 {@link #findEffectiveByProject}.
   */
  public List<MemberResponse> findAllByProject(Long projectId) {
    return dsl.select(
            PROJECT_MEMBER.USER_ID,
            USER.USERNAME,
            USER.NAME,
            USER.KIND,
            PROJECT_MEMBER.ROLE,
            PROJECT_MEMBER.CREATED_AT,
            MEMBER_ACTIVE)
        .from(PROJECT_MEMBER)
        .join(USER)
        .on(USER.ID.eq(PROJECT_MEMBER.USER_ID))
        .leftJoin(MEMBERSHIP)
        .on(WorkspaceActive.join(PROJECT_MEMBER.USER_ID, PROJECT_MEMBER.TENANT_ID))
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId))
        .orderBy(PROJECT_MEMBER.CREATED_AT.asc())
        .fetch(this::mapToMemberResponse);
  }

  /**
   * 프로젝트의 <b>실효</b> 멤버 전원(WP-1057) — 직접 멤버 행(가입순, direct=true) 뒤에 멤버로 둔 조직도 부서·하위 부서로만 들어온 활성
   * 사람(이름순, 역할 MEMBER, direct=false). 직접 멤버이면서 부서에도 걸린 사람은 직접 행 하나로만 나온다(실효 역할 = 직접 행 역할 — 부서의
   * MEMBER 보다 낮지 않다). 담당자·멘션·필터 후보와 멤버 관리 화면이 함께 쓴다. 부서 행이 없는 프로젝트(대부분)는 부서 조회를 건너뛴다.
   */
  public List<MemberResponse> findEffectiveByProject(Long projectId) {
    List<MemberResponse> out = new ArrayList<>(findAllByProject(projectId));
    if (!hasGroups(projectId)) {
      return out;
    }
    Set<Long> direct = new HashSet<>();
    out.forEach(m -> direct.add(m.userId()));
    var dept = departmentAudience("pmr_d", projectId);
    Field<OffsetDateTime> addedAt = DSL.min(dept.group().ADDED_AT);
    dsl.select(USER.ID, USER.USERNAME, USER.NAME, USER.KIND, addedAt)
        .from(dept.table())
        .join(USER)
        .on(USER.ID.eq(dept.userId()))
        .groupBy(USER.ID, USER.USERNAME, USER.NAME, USER.KIND)
        .orderBy(USER.NAME.asc(), USER.ID.asc())
        .fetch()
        .forEach(
            r -> {
              if (direct.contains(r.value1())) {
                return;
              }
              // 부서 구성원은 활성 사람만 세므로(Departments.activeHumanMember) active 는 늘 true 다.
              out.add(
                  new MemberResponse(
                      r.value1(),
                      r.value2(),
                      r.value3(),
                      r.value4(),
                      ProjectMembership.GROUP_ROLE,
                      r.value5() != null ? r.value5().toInstant() : null,
                      true,
                      false));
            });
    return out;
  }

  /** username/name/kind/active 까지 채워진 멤버 단건 조회. addMember/updateMemberRole 응답에 사용. */
  public Optional<MemberResponse> findMemberWithUser(Long projectId, Long userId) {
    return dsl.select(
            PROJECT_MEMBER.USER_ID,
            USER.USERNAME,
            USER.NAME,
            USER.KIND,
            PROJECT_MEMBER.ROLE,
            PROJECT_MEMBER.CREATED_AT,
            MEMBER_ACTIVE)
        .from(PROJECT_MEMBER)
        .join(USER)
        .on(USER.ID.eq(PROJECT_MEMBER.USER_ID))
        .leftJoin(MEMBERSHIP)
        .on(WorkspaceActive.join(PROJECT_MEMBER.USER_ID, PROJECT_MEMBER.TENANT_ID))
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.USER_ID.eq(userId)))
        .fetchOptional(this::mapToMemberResponse);
  }

  /** 멤버 추가. */
  public void insert(Long projectId, Long userId, String role) {
    dsl.insertInto(PROJECT_MEMBER)
        .set(PROJECT_MEMBER.PROJECT_ID, projectId)
        .set(PROJECT_MEMBER.USER_ID, userId)
        .set(PROJECT_MEMBER.ROLE, role)
        .execute();
  }

  /** 멤버 역할 변경. */
  public void updateRole(Long projectId, Long userId, String role) {
    dsl.update(PROJECT_MEMBER)
        .set(PROJECT_MEMBER.ROLE, role)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.USER_ID.eq(userId)))
        .execute();
  }

  /** 멤버 제거. */
  public void delete(Long projectId, Long userId) {
    dsl.deleteFrom(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.USER_ID.eq(userId)))
        .execute();
  }

  /**
   * 프로젝트의 OWNER 멤버 행을 잠그고 그 수를 돌려준다(WP-753). 「마지막 소유자」 판정을 이 잠근 집합으로 해야, 두 소유자가 서로를 동시에 강등·제거할 때 나중
   * 요청이 앞 요청의 커밋을 기다렸다가 줄어든 소유자로 판정한다 — {@link #countOwners} 는 둘 다 커밋 전의 소유자 2명을 보고 통과해 소유자 0명이 됐다.
   * 같은 행을 잡는 순서가 엇갈려 교착하지 않게 user_id 순으로 잠근다. 쓰기 트랜잭션에서만 부른다(읽기 전용 트랜잭션은 FOR UPDATE 를 거부한다).
   */
  public long lockOwnersAndCount(Long projectId) {
    return dsl.select(PROJECT_MEMBER.USER_ID)
        .from(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.ROLE.eq("OWNER")))
        .orderBy(PROJECT_MEMBER.USER_ID)
        .forUpdate()
        .fetch()
        .size();
  }

  /** 프로젝트의 OWNER 멤버 수. 마지막 OWNER 보호 체크에 사용. */
  public long countOwners(Long projectId) {
    return dsl.select(count())
        .from(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.ROLE.eq("OWNER")))
        .fetchOne(0, Long.class);
  }

  /**
   * 프로젝트 <b>실효</b> 멤버의 user_id 목록(중복 없음) — 직접 멤버 + 멤버로 둔 조직도 부서의 활성 사람 구성원(WP-1057). 프로젝트 알림(실시간)
   * 대상 계산 등.
   */
  public List<Long> findUserIdsByProject(Long projectId) {
    return dsl.fetch(ProjectMembership.memberUserIds(DSL.val(projectId))).into(Long.class);
  }

  /** 멤버로 둔 조직도 부서·하위 부서로 들어오는 활성 사람 user_id(직접 멤버 여부와 무관, 중복 없음) — 부서 변화 전 명단 스냅숏용(WP-1057). */
  public Set<Long> findDepartmentUserIds(Long projectId) {
    return findDepartmentUserIdsByProjects(List.of(projectId)).get(projectId);
  }

  /**
   * 여러 프로젝트의 부서로 들어오는 활성 사람 user_id 를 한 번에(프로젝트 id → 사람 id, 부서 행이 없거나 아무도 없는 프로젝트는 빈 집합) — 조직도 변경 전
   * 명단 스냅숏을 프로젝트마다 따로 재귀 조회하지 않게 묶었다(WP-1057).
   */
  public Map<Long, Set<Long>> findDepartmentUserIdsByProjects(Collection<Long> projectIds) {
    Map<Long, Set<Long>> out = new LinkedHashMap<>();
    projectIds.forEach(id -> out.put(id, new HashSet<>()));
    if (projectIds.isEmpty()) return out;
    var dept = departmentAudience("pmr_db", projectIds, null);
    dsl.selectDistinct(dept.group().PROJECT_ID, dept.userId())
        .from(dept.table())
        .fetch()
        .forEach(r -> out.get(r.value1()).add(r.value2()));
    return out;
  }

  /**
   * 주어진 사용자 중 이 프로젝트 <b>실효</b> 멤버인 user_id(직접 멤버 또는 조직도 부서, WP-1057) — 잠그지 않는 읽기(읽기 전용 트랜잭션에서도 쓴다).
   */
  public Set<Long> findMemberUserIds(Long projectId, Collection<Long> userIds) {
    return findMemberUserIdsByProjects(Map.of(projectId, userIds)).get(projectId);
  }

  /**
   * 프로젝트마다 주어진 사용자 중 <b>실효</b> 멤버인 user_id(프로젝트 id → 사람 id) — 후보만 본다: 직접 행은 (프로젝트, 후보)로, 부서 쪽은 부서
   * 트리의 구성원 행을 후보로 먼저 거른다({@link ProjectMembership#departmentAudience} 의 onlyUserIds). 실효 멤버 전원을
   * 만들지 않고, 여러 프로젝트를 한 번에(직접 1 + 부서 1 조회) 판정한다. 직접 행으로 모두 판정되면 부서 조회를 건너뛴다.
   */
  public Map<Long, Set<Long>> findMemberUserIdsByProjects(
      Map<Long, ? extends Collection<Long>> candidates) {
    Map<Long, Set<Long>> out = new LinkedHashMap<>();
    candidates.keySet().forEach(id -> out.put(id, new HashSet<>()));
    Set<Long> users = new HashSet<>();
    candidates.values().forEach(users::addAll);
    if (users.isEmpty()) return out;
    // 프로젝트 × 후보 합집합으로 읽으므로 각 프로젝트의 후보만 남긴다.
    dsl.select(PROJECT_MEMBER.PROJECT_ID, PROJECT_MEMBER.USER_ID)
        .from(PROJECT_MEMBER)
        .where(PROJECT_MEMBER.PROJECT_ID.in(candidates.keySet()))
        .and(PROJECT_MEMBER.USER_ID.in(users))
        .fetch()
        .forEach(r -> keep(out, candidates, r.value1(), r.value2()));
    Set<Long> rest = new HashSet<>();
    candidates.forEach(
        (projectId, ids) ->
            ids.stream().filter(id -> !out.get(projectId).contains(id)).forEach(rest::add));
    if (rest.isEmpty()) return out;
    var dept = departmentAudience("pmr_mb", candidates.keySet(), rest);
    dsl.selectDistinct(dept.group().PROJECT_ID, dept.userId())
        .from(dept.table())
        .fetch()
        .forEach(r -> keep(out, candidates, r.value1(), r.value2()));
    return out;
  }

  /**
   * 프로젝트(들)의 부서로 들어오는 사람({@link ProjectMembership#departmentAudience}) — 이 리포지토리의 부서 쪽 조회가 모두 이것을
   * 쓴다.
   */
  private static ProjectMembership.DepartmentAudience departmentAudience(
      String alias, Collection<Long> projectIds, Collection<Long> onlyUserIds) {
    return ProjectMembership.departmentAudience(
        alias, g -> g.PROJECT_ID.in(projectIds), onlyUserIds);
  }

  /** 한 프로젝트의 부서로 들어오는 사람 전원. */
  private static ProjectMembership.DepartmentAudience departmentAudience(
      String alias, Long projectId) {
    return ProjectMembership.departmentAudience(alias, g -> g.PROJECT_ID.eq(projectId), null);
  }

  /** 판정 결과 모으기 — 그 프로젝트의 후보인 사람만 남긴다. */
  private static void keep(
      Map<Long, Set<Long>> out,
      Map<Long, ? extends Collection<Long>> candidates,
      Long projectId,
      Long userId) {
    if (candidates.get(projectId).contains(userId)) {
      out.get(projectId).add(userId);
    }
  }

  /**
   * 멤버 행을 공유 잠금하고 있는지 돌려준다(WP-776) — 멤버십을 근거로 무언가를 남기는 쓰기(구독 등)가 커밋할 때까지 그 멤버 제거(행 삭제)를 기다리게 하고,
   * 제거가 먼저 커밋됐으면 행이 없어 false 다. 읽기 전용 트랜잭션에서는 쓰지 않는다(PG 가 FOR SHARE 를 거절).
   */
  public boolean lockMember(Long projectId, Long userId) {
    return !lockMemberUserIds(projectId, List.of(userId)).isEmpty();
  }

  /**
   * 주어진 사용자 중 이 프로젝트 멤버인 user_id 를, 그 멤버 행을 공유 잠금한 채 돌려준다(WP-775) — 담당자 지정이 커밋할 때까지 그 멤버 제거(행 삭제)를
   * 기다리게 하고, 제거가 먼저 커밋됐으면 행이 없어 빠진다. 읽기 전용 트랜잭션에서는 쓰지 않는다(PG 가 FOR SHARE 를 거절).
   */
  public Set<Long> lockMemberUserIds(Long projectId, Collection<Long> userIds) {
    if (userIds.isEmpty()) return Set.of();
    Set<Long> out =
        new HashSet<>(
            dsl.select(PROJECT_MEMBER.USER_ID)
                .from(PROJECT_MEMBER)
                .where(
                    PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.USER_ID.in(userIds)))
                .orderBy(PROJECT_MEMBER.USER_ID)
                .forShare()
                .fetch(PROJECT_MEMBER.USER_ID));
    List<Long> rest = userIds.stream().filter(id -> !out.contains(id)).distinct().toList();
    if (rest.isEmpty()) {
      return out;
    }
    // 직접 행이 없는 사람은 멤버로 둔 조직도 부서로 들어오는지 본다(WP-1057) — 걸리는 부서 행을 공유 잠금해, 동시에 들어온 부서 행 제거가 이 쓰기의
    // 커밋을 기다렸다가 정리(담당자 해제 등)하게 한다.
    // 사람을 부서 구성원으로 만드는 구성원 행(user_group_member)도 판정 전에 먼저 공유 잠근다(WP-1128) — 부서에서 빼기(행 삭제)가 이 쓰기의
    // 커밋을
    // 기다려, 커밋 직전 정리가 이 담당을 보고 해제한다. 먼저 빼기가 진행 중이면 이쪽이 그 커밋을 기다린 뒤 행이 없어 아래 판정에서 빠진다(잠근 뒤
    // 판정해야 그 사이에 커밋된 빼기를 놓치지 않는다).
    dsl.select(USER_GROUP_MEMBER.GROUP_ID)
        .from(USER_GROUP_MEMBER)
        .where(USER_GROUP_MEMBER.TARGET_TYPE.eq("MEMBER").and(USER_GROUP_MEMBER.TARGET_ID.in(rest)))
        .orderBy(USER_GROUP_MEMBER.GROUP_ID, USER_GROUP_MEMBER.TARGET_ID)
        .forShare()
        .execute();
    var dept = departmentAudience("pmr_lk", List.of(projectId), rest);
    var g = dept.group();
    dsl.select(g.GROUP_ID, dept.userId())
        .from(dept.table())
        .orderBy(g.GROUP_ID)
        .forShare()
        .of(g)
        .fetch()
        .forEach(r -> out.add(r.value2()));
    return out;
  }

  /** 프로젝트에 멤버로 둔 조직도 부서 행이 있는가 — 없으면(대부분) 실효 멤버 명단의 부서 조회를 건너뛴다. */
  private boolean hasGroups(Long projectId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(PROJECT_MEMBER_GROUP)
            .where(PROJECT_MEMBER_GROUP.PROJECT_ID.eq(projectId)));
  }

  /** 사용자가 이 프로젝트의 <b>직접</b> 멤버 행을 가졌는가 — 「이미 멤버」 판정용(부서로 들어온 사람도 직접 멤버로 더할 수 있다, WP-1057). */
  public boolean isDirectMember(Long projectId, Long userId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(PROJECT_MEMBER)
            .where(PROJECT_MEMBER.PROJECT_ID.eq(projectId).and(PROJECT_MEMBER.USER_ID.eq(userId))));
  }

  /**
   * 사람(userId)이 여러 프로젝트에서 갖는 실효 역할을 한 번에 구한다(WP-1129) — 프로젝트 목록이 행마다 {@link #find} 를 불러 부서 상위 재귀를
   * 프로젝트 수만큼 돌리던 것을 한 쿼리로 묶는다. 직접 역할이 있으면 그것, 없고 부서로 걸리면 MEMBER({@link
   * ProjectMembership#effectiveRole} 과 같은 규칙). 부서 쪽은 {@link
   * ProjectMembership#projectIdsViaDepartment} 를 LEFT JOIN 해 한 번만 계산한다.
   *
   * @return projectId → 역할(멤버가 아닌 프로젝트는 없다)
   */
  public Map<Long, String> findRolesByProjects(Collection<Long> projectIds, Long userId) {
    Map<Long, String> out = new HashMap<>();
    if (projectIds.isEmpty() || userId == null) return out;
    var viaDept = ProjectMembership.projectIdsViaDepartment(DSL.val(userId)).asTable("pmr_rv");
    Field<Long> viaDeptProject = viaDept.field(0, Long.class);
    Field<String> role =
        DSL.coalesce(
            PROJECT_MEMBER.ROLE,
            DSL.when(viaDeptProject.isNotNull(), DSL.inline(ProjectMembership.GROUP_ROLE)));
    dsl.select(PROJECT.ID, role)
        .from(PROJECT)
        .leftJoin(PROJECT_MEMBER)
        .on(PROJECT_MEMBER.PROJECT_ID.eq(PROJECT.ID).and(PROJECT_MEMBER.USER_ID.eq(userId)))
        .leftJoin(viaDept)
        .on(viaDeptProject.eq(PROJECT.ID))
        .where(PROJECT.ID.in(projectIds))
        .fetch()
        .forEach(
            r -> {
              if (r.value2() != null) out.put(r.value1(), r.value2());
            });
    return out;
  }

  /** 프로젝트 카드의 멤버 미리보기 — 실효 멤버 수와 앞에서부터 보일 이름(최대 {@code limit}명). */
  public record MemberPreview(int count, List<String> topNames) {}

  /**
   * 여러 프로젝트의 <b>실효</b> 멤버 수와 앞 이름을 한 번에 모은다(N+1 회피) — 직접 멤버(created_at asc) 뒤에 멤버로 둔 조직도 부서로만 들어온
   * 사람(이름순, WP-1057). 목록 카드의 「멤버 N명」과 이름 미리보기가 접근 판정과 같은 명단을 보이게.
   *
   * <p>부서 쪽은 부서 행이 있는 프로젝트만 보고, 사람마다 이름을 다 받지 않고 프로젝트별 인원 수와 앞 {@code limit}명만 받는다(WP-1129) — 큰 부서를
   * 둔 프로젝트가 목록에 있어도 받는 행이 부서 크기에 비례하지 않게. 직접·부서 양쪽에 걸린 사람은 직접 쪽으로만 센다.
   *
   * @return projectId → 멤버 미리보기(멤버가 없는 프로젝트는 없다)
   */
  public Map<Long, MemberPreview> findMemberPreviewsByProjects(List<Long> projectIds, int limit) {
    Map<Long, MemberPreview> result = new LinkedHashMap<>();
    if (projectIds.isEmpty()) return result;
    Map<Long, List<String>> direct = new LinkedHashMap<>();
    dsl.select(PROJECT_MEMBER.PROJECT_ID, USER.NAME)
        .from(PROJECT_MEMBER)
        .join(USER)
        .on(USER.ID.eq(PROJECT_MEMBER.USER_ID))
        .where(PROJECT_MEMBER.PROJECT_ID.in(projectIds))
        .orderBy(PROJECT_MEMBER.PROJECT_ID.asc(), PROJECT_MEMBER.CREATED_AT.asc())
        .fetch()
        .forEach(r -> direct.computeIfAbsent(r.value1(), k -> new ArrayList<>()).add(r.value2()));
    direct.forEach(
        (pid, names) ->
            result.put(pid, new MemberPreview(names.size(), names.stream().limit(limit).toList())));
    // 부서 행이 있는 프로젝트만 부서 쪽을 본다 — 부서를 쓰지 않는 목록이면 부서 트리 조회를 아예 하지 않는다.
    List<Long> withGroups =
        dsl.selectDistinct(PROJECT_MEMBER_GROUP.PROJECT_ID)
            .from(PROJECT_MEMBER_GROUP)
            .where(PROJECT_MEMBER_GROUP.PROJECT_ID.in(projectIds))
            .fetch(PROJECT_MEMBER_GROUP.PROJECT_ID);
    if (withGroups.isEmpty()) return result;
    var dept = departmentAudience("pmr_nm", withGroups, null);
    var g = dept.group();
    ProjectMember dm = PROJECT_MEMBER.as("pmr_nm_m");
    // 부서로만 들어온 사람(직접 멤버 제외, 여러 부서로 걸려도 한 번) → 프로젝트별 이름순 번호·인원 수 → 앞 limit 명만.
    Table<?> people =
        dsl.selectDistinct(g.PROJECT_ID.as("pid"), USER.ID.as("uid"), USER.NAME.as("name"))
            .from(dept.table())
            .join(USER)
            .on(USER.ID.eq(dept.userId()))
            .whereNotExists(
                DSL.selectOne()
                    .from(dm)
                    .where(dm.PROJECT_ID.eq(g.PROJECT_ID))
                    .and(dm.USER_ID.eq(USER.ID)))
            .asTable("pmr_nm_p");
    Field<Long> pid = people.field("pid", Long.class);
    Field<Long> uid = people.field("uid", Long.class);
    Field<String> name = people.field("name", String.class);
    Table<?> ranked =
        dsl.select(
                pid,
                name,
                DSL.rowNumber().over(DSL.partitionBy(pid).orderBy(name.asc(), uid.asc())).as("rn"),
                DSL.count().over(DSL.partitionBy(pid)).as("cnt"))
            .from(people)
            .asTable("pmr_nm_r");
    Field<Long> rPid = ranked.field("pid", Long.class);
    Field<String> rName = ranked.field("name", String.class);
    Field<Integer> rn = ranked.field("rn", Integer.class);
    Field<Integer> cnt = ranked.field("cnt", Integer.class);
    Map<Long, Integer> deptCount = new HashMap<>();
    Map<Long, List<String>> deptNames = new HashMap<>();
    dsl.select(rPid, rName, cnt)
        .from(ranked)
        .where(rn.le(limit))
        .orderBy(rPid.asc(), rn.asc())
        .fetch()
        .forEach(
            r -> {
              deptCount.put(r.value1(), r.value3());
              deptNames.computeIfAbsent(r.value1(), k -> new ArrayList<>()).add(r.value2());
            });
    deptCount.forEach(
        (p, n) -> {
          MemberPreview d = result.get(p);
          List<String> top = new ArrayList<>(d == null ? List.of() : d.topNames());
          deptNames.get(p).stream().limit(Math.max(0, limit - top.size())).forEach(top::add);
          result.put(p, new MemberPreview((d == null ? 0 : d.count()) + n, List.copyOf(top)));
        });
    return result;
  }
}
