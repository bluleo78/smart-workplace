package com.workplace.member.repository;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_GROUP;

import com.workplace.global.org.Departments;
import com.workplace.global.tenant.WorkspaceActive;
import com.workplace.global.util.LikePatternUtils;
import com.workplace.member.dto.MemberSummary;
import com.workplace.user.dto.AgentUsernames;
import com.workplace.user.dto.UserKind;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Stream;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.SelectField;
import org.jooq.SelectOnConditionStep;
import org.jooq.SortField;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * 구성원 디렉터리 조회 (#833).
 *
 * <p>{@code user} 는 전역 테이블(tenant_id 컬럼도 RLS 정책도 없음)이고 {@code membership} 도 RLS 비대상 컨트롤 플레인 테이블이다.
 * 따라서 테넌트 경계는 자동으로 걸리지 않으며, 반드시 membership 조인 + tenant_id 조건으로 명시해야 한다. 이 규칙을 어기면 다른 테넌트 사용자가 그대로
 * 노출된다.
 *
 * <p>목록·카운트·단건이 {@link #scope} 하나를 공유한다 — 조건이 갈라지면 total 과 실제 목록이 어긋난다.
 */
@Repository
@RequiredArgsConstructor
public class MemberDirectoryRepository {

  private final DSLContext dsl;

  /**
   * 소속 부서(WP-1048) — 이 사람이 직접 속한 조직도(공유 그룹) 부서(공통 규칙 {@link Departments#directDepartmentOf}) 하나의
   * 이름. 여럿이면 정렬 순서·id 가 앞인 부서, 없으면 null. 사람을 고르는 목록(노트 공유 대상 등)에서 동명이인·같은 이름 조각을 가르도록 이름 옆에 보인다.
   * 부서는 이 행의 멤버십 테넌트 것만 본다(RLS 와 같은 경계를 조건으로도 둔다).
   */
  private static final Field<String> DEPARTMENT =
      DSL.field(
              DSL.select(USER_GROUP.NAME)
                  .from(USER_GROUP)
                  .where(Departments.directDepartmentOf(USER_GROUP, USER.ID))
                  .and(USER_GROUP.TENANT_ID.eq(MEMBERSHIP.TENANT_ID))
                  .orderBy(USER_GROUP.SORT_ORDER.asc(), USER_GROUP.ID.asc())
                  .limit(1))
          .as("department");

  /** 목록/단건 공용 컬럼. 한 곳에만 둬야 컬럼 추가 시 누락이 없다. */
  private static final List<SelectField<?>> FIELDS =
      List.of(
          USER.ID,
          USER.USERNAME,
          USER.NAME,
          USER.EMAIL,
          USER.TITLE,
          USER.KIND,
          USER.IS_ACTIVE,
          MEMBERSHIP.ROLE,
          MEMBERSHIP.STATUS,
          USER.DESCRIPTION,
          USER.AGENT_RUNTIME,
          DEPARTMENT);

  /** AI 본인 단건 조회 컬럼 — 공용 컬럼에 지시(WP-1077)를 더한다. */
  private static final List<SelectField<?>> FIELDS_WITH_INSTRUCTIONS =
      Stream.concat(FIELDS.stream(), Stream.of(USER.INSTRUCTIONS)).toList();

  /** 목록/단건 공용 select + join. */
  private SelectOnConditionStep<Record> base() {
    return base(FIELDS);
  }

  /** 공용 join 에 고른 컬럼만 — 단건 본인 조회가 지시 컬럼을 더할 때 쓴다(WP-1077). */
  private SelectOnConditionStep<Record> base(List<SelectField<?>> fields) {
    return dsl.select(fields).from(USER).join(MEMBERSHIP).on(MEMBERSHIP.USER_ID.eq(USER.ID));
  }

  /**
   * 테넌트 경계 + 활성 여부 + kind + 검색어 조건. 목록과 카운트가 반드시 같은 조건을 써야 페이지 수가 맞는다.
   *
   * @param kind {@link UserKind#ALL_FILTER} 면 사람·AI 모두 포함
   * @param includeInactive false 면 비활성 계정·비-ACTIVE 멤버십 제외(기본 디렉터리 동작)
   */
  private Condition scope(long tenantId, String search, String kind, boolean includeInactive) {
    Condition condition = MEMBERSHIP.TENANT_ID.eq(tenantId);
    if (!includeInactive) {
      condition = condition.and(WorkspaceActive.condition());
    }
    if (kind != null && !kind.isBlank() && !UserKind.ALL_FILTER.equals(kind)) {
      condition = condition.and(USER.KIND.eq(kind));
    }
    if (search != null && !search.isBlank()) {
      // LIKE 메타문자(%, _)를 이스케이프하지 않으면 검색어의 % 가 와일드카드로 동작한다.
      String pattern = LikePatternUtils.containsPattern(search);
      condition =
          condition.and(
              USER.NAME
                  .likeIgnoreCase(pattern, '\\')
                  .or(USER.USERNAME.likeIgnoreCase(pattern, '\\'))
                  .or(USER.EMAIL.likeIgnoreCase(pattern, '\\')));
    }
    return condition;
  }

  /**
   * 현재 테넌트의 구성원 목록. 이름 오름차순(동명이인은 id 순)으로 안정 정렬한다.
   *
   * <p>검색어가 있으면 아이디·이름·이메일이 검색어와 정확히 같은 행을 맨 앞에 둔다(#844). 부분일치만으로 이름순 정렬하면 흔한 이름 조각("kim")을 쓰는 사람이
   * 많을 때 정확히 그 아이디인 사람이 첫 페이지 밖으로 밀려, 첫 페이지에서 username 을 찾는 AI 해석이 "없음"으로 오판한다.
   */
  @Transactional(readOnly = true)
  public List<MemberSummary> findPage(
      long tenantId,
      Long viewerId,
      String search,
      String kind,
      boolean includeInactive,
      long offset,
      int limit) {
    return base()
        .where(scope(tenantId, search, kind, includeInactive).and(hideOthersAssistants(viewerId)))
        .orderBy(sortFields(search))
        .offset(offset)
        .limit(limit)
        .fetch(r -> map(r, false));
  }

  /**
   * 목록에서 남의 개인 비서를 뺀다(WP-638) — 개인 비서는 주인의 AI 키로 도는 주인 전용이라, 디렉터리·멘션 후보(웹 @멘션·DM 받는 사람·MCP
   * search_members)에 나오면 남이 불러 주인 키를 쓰게 된다. 보는 사람(viewerId)의 비서만 남기고, viewerId 가 없으면 개인 비서를 모두 뺀다.
   * 단건 조회(findOne)에는 걸지 않는다 — 주인이 맡긴 이슈의 담당자처럼 이미 화면에 보이는 비서의 카드는 열려야 한다.
   */
  private static Condition hideOthersAssistants(Long viewerId) {
    Condition personal = USER.USERNAME.startsWith(AgentUsernames.PERSONAL_ASSISTANT_PREFIX);
    Condition mine =
        viewerId == null
            ? DSL.falseCondition()
            : USER.USERNAME.eq(AgentUsernames.personalAssistantOf(viewerId));
    return personal.not().or(mine);
  }

  /** 목록 정렬 키. 검색어가 있으면 정확일치(대소문자 무시) 행을 앞에 두는 키를 선두에 붙인다. */
  private static List<SortField<?>> sortFields(String search) {
    if (search == null || search.isBlank()) return List.of(USER.NAME.asc(), USER.ID.asc());
    String term = search.trim();
    SortField<Integer> exactFirst =
        DSL.when(
                USER.USERNAME
                    .equalIgnoreCase(term)
                    .or(USER.NAME.equalIgnoreCase(term))
                    .or(USER.EMAIL.equalIgnoreCase(term)),
                DSL.inline(0))
            .otherwise(DSL.inline(1))
            .asc();
    return List.of(exactFirst, USER.NAME.asc(), USER.ID.asc());
  }

  /** 같은 조건의 총원. 검색·필터를 동일하게 적용해야 totalPages 가 실제 페이지 수와 맞는다. */
  @Transactional(readOnly = true)
  public int count(
      long tenantId, Long viewerId, String search, String kind, boolean includeInactive) {
    Integer count =
        dsl.selectCount()
            .from(USER)
            .join(MEMBERSHIP)
            .on(MEMBERSHIP.USER_ID.eq(USER.ID))
            .where(
                scope(tenantId, search, kind, includeInactive).and(hideOthersAssistants(viewerId)))
            .fetchOne(0, Integer.class);
    return count == null ? 0 : count;
  }

  /**
   * 단건 조회. 다른 테넌트 사용자는 빈 값 — 존재 자체를 노출하지 않는다. withInstructions 면 AI 의 지시(WP-1077)도 같은 쿼리로 읽어 싣는다 —
   * AI 본인 조회에서만 켠다(목록·남의 조회는 지시 컬럼을 읽지도 않는다).
   */
  @Transactional(readOnly = true)
  public Optional<MemberSummary> findOne(long tenantId, long userId, boolean withInstructions) {
    return base(withInstructions ? FIELDS_WITH_INSTRUCTIONS : FIELDS)
        .where(scope(tenantId, null, UserKind.ALL_FILTER, true).and(USER.ID.eq(userId)))
        .fetchOptional(r -> map(r, withInstructions));
  }

  /**
   * username 집합(대소문자 무시)과 일치하는 현재 테넌트 구성원의 (username, userId) 목록. 비활성·정지 멤버도 포함한다(과거 이슈의 담당/작성자 필터가
   * 가능해야 하므로). 다른 테넌트 사용자는 빠져 존재 여부가 노출되지 않는다. username UNIQUE 는 대소문자를 구분하므로 같은 소문자형에 여러 행이 올 수 있다
   * — 모호성 판단은 호출측 몫이라 Map 이 아닌 목록으로 돌려준다. 이슈 검색 필터 해석용(#841).
   */
  @Transactional(readOnly = true)
  public List<Map.Entry<String, Long>> findByUsernamesIgnoreCase(
      long tenantId, Collection<String> usernames) {
    if (usernames.isEmpty()) return List.of();
    List<String> lowered = usernames.stream().map(u -> u.toLowerCase(Locale.ROOT)).toList();
    return dsl.select(USER.USERNAME, USER.ID)
        .from(USER)
        .join(MEMBERSHIP)
        .on(MEMBERSHIP.USER_ID.eq(USER.ID))
        .where(MEMBERSHIP.TENANT_ID.eq(tenantId).and(DSL.lower(USER.USERNAME).in(lowered)))
        .fetch(r -> Map.entry(r.get(USER.USERNAME), r.get(USER.ID)));
  }

  private MemberSummary map(Record r, boolean withInstructions) {
    boolean isAgent = UserKind.isAgent(r.get(USER.KIND));
    return new MemberSummary(
        r.get(USER.ID),
        r.get(USER.USERNAME),
        r.get(USER.NAME),
        r.get(USER.EMAIL),
        r.get(USER.TITLE),
        r.get(USER.KIND),
        // WP-417: active = 이 워크스페이스에서 활성(공용 정의 — 관리자 정지는 멤버십만 SUSPENDED 로 바꾼다).
        WorkspaceActive.of(Boolean.TRUE.equals(r.get(USER.IS_ACTIVE)), r.get(MEMBERSHIP.STATUS)),
        r.get(MEMBERSHIP.ROLE),
        r.get(MEMBERSHIP.STATUS),
        // 설명(역할)·실행 방식은 AI 에만 뜻이 있다 — 사람 행의 컬럼 값(실행 방식 기본값 INTERNAL 등)은 내보내지 않는다.
        isAgent ? r.get(USER.DESCRIPTION) : null,
        isAgent ? r.get(USER.AGENT_RUNTIME) : null,
        r.get(DEPARTMENT),
        // 지시(WP-1077)는 AI 본인 단건 조회만 싣는다 — 그 밖에는 컬럼을 읽지 않았다.
        withInstructions && isAgent ? r.get(USER.INSTRUCTIONS) : null,
        // 자리(WP-1205)는 저장소가 모른다 — 서비스가 AI 본인 조회에만 붙인다.
        null);
  }
}
