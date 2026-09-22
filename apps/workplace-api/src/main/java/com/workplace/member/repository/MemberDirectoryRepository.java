package com.workplace.member.repository;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;

import com.workplace.global.util.LikePatternUtils;
import com.workplace.member.dto.MemberSummary;
import com.workplace.user.dto.UserKind;
import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.SelectField;
import org.jooq.SelectOnConditionStep;
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
          MEMBERSHIP.STATUS);

  /** 목록/단건 공용 select + join. */
  private SelectOnConditionStep<Record> base() {
    return dsl.select(FIELDS).from(USER).join(MEMBERSHIP).on(MEMBERSHIP.USER_ID.eq(USER.ID));
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
      condition = condition.and(MEMBERSHIP.STATUS.eq("ACTIVE")).and(USER.IS_ACTIVE.isTrue());
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

  /** 현재 테넌트의 구성원 목록. 이름 오름차순(동명이인은 id 순)으로 안정 정렬한다. */
  @Transactional(readOnly = true)
  public List<MemberSummary> findPage(
      long tenantId, String search, String kind, boolean includeInactive, int offset, int limit) {
    return base()
        .where(scope(tenantId, search, kind, includeInactive))
        .orderBy(USER.NAME.asc(), USER.ID.asc())
        .offset(offset)
        .limit(limit)
        .fetch(this::map);
  }

  /** 같은 조건의 총원. 검색·필터를 동일하게 적용해야 totalPages 가 실제 페이지 수와 맞는다. */
  @Transactional(readOnly = true)
  public int count(long tenantId, String search, String kind, boolean includeInactive) {
    Integer count =
        dsl.selectCount()
            .from(USER)
            .join(MEMBERSHIP)
            .on(MEMBERSHIP.USER_ID.eq(USER.ID))
            .where(scope(tenantId, search, kind, includeInactive))
            .fetchOne(0, Integer.class);
    return count == null ? 0 : count;
  }

  /** 단건 조회. 다른 테넌트 사용자는 빈 값 — 존재 자체를 노출하지 않는다. */
  @Transactional(readOnly = true)
  public Optional<MemberSummary> findOne(long tenantId, long userId) {
    return base()
        .where(scope(tenantId, null, UserKind.ALL_FILTER, true).and(USER.ID.eq(userId)))
        .fetchOptional(this::map);
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

  private MemberSummary map(Record r) {
    return new MemberSummary(
        r.get(USER.ID),
        r.get(USER.USERNAME),
        r.get(USER.NAME),
        r.get(USER.EMAIL),
        r.get(USER.TITLE),
        r.get(USER.KIND),
        Boolean.TRUE.equals(r.get(USER.IS_ACTIVE)),
        r.get(MEMBERSHIP.ROLE),
        r.get(MEMBERSHIP.STATUS));
  }
}
