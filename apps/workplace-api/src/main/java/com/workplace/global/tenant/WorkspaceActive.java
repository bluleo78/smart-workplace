package com.workplace.global.tenant;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.USER;

import com.workplace.tenant.repository.MembershipRepository;
import org.jooq.Condition;
import org.jooq.Field;
import org.jooq.impl.DSL;

/**
 * WP-417: "이 워크스페이스에서 활성" 판정의 단일 정의 — 전역 계정 활성(user.is_active) && 그 워크스페이스 멤버십 ACTIVE. 워크스페이스 관리자의
 * 「활성 상태」 끄기는 멤버십만 SUSPENDED 로 바꾸므로, 테넌트 범위의 active 표시·후보 판정은 모두 이 술어를 쓴다.
 *
 * <p>술어는 MEMBERSHIP 을 대상 테넌트로 붙인 쿼리에서만 의미가 있어, 조인 조건({@link #join})을 짝으로 제공한다. membership 은 RLS 비대상
 * 전역 테이블이라 tenant_id 조건을 반드시 명시해야 다른 워크스페이스 행이 섞이지 않는다.
 *
 * <p>멤버십 행이 없으면(LEFT JOIN 의 NULL) 비활성 — V44 가 당시 모든 사용자에게 Tenant#1 멤버십을 백필했고 이후 사용자 생성 경로(가입·구성원
 * 추가·에이전트·개인 비서·운영자 콘솔)는 모두 멤버십을 함께 만들며, 프로젝트 멤버 추가도 ACTIVE 멤버만 허용(#713)하므로 정상 데이터에는 없다.
 */
public final class WorkspaceActive {

  private WorkspaceActive() {}

  /** USER(또는 주어진 user id 컬럼) 에 대상 테넌트의 MEMBERSHIP 행을 붙이는 조인 조건. */
  public static Condition join(Field<Long> userId, Field<Long> tenantId) {
    return MEMBERSHIP.USER_ID.eq(userId).and(MEMBERSHIP.TENANT_ID.eq(tenantId));
  }

  /** {@link #join(Field, Field)} 의 USER.ID 판. */
  public static Condition join(Field<Long> tenantId) {
    return join(USER.ID, tenantId);
  }

  /** {@link #join(Field, Field)} 의 USER.ID + 고정 테넌트 판. */
  public static Condition join(long tenantId) {
    return join(USER.ID, DSL.val(tenantId));
  }

  /** 술어 — {@link #join} 으로 MEMBERSHIP 을 붙인 쿼리의 where 에 쓴다. */
  public static Condition condition() {
    return USER.IS_ACTIVE.isTrue().and(MEMBERSHIP.STATUS.eq(MembershipRepository.STATUS_ACTIVE));
  }

  /** 술어를 select 컬럼으로 — 목록이 active 값으로 그대로 내보낸다. LEFT JOIN 에서도 NULL 이 되지 않게 false 로 감싼다. */
  public static Field<Boolean> field() {
    return DSL.field(DSL.coalesce(DSL.field(condition()), DSL.inline(false)))
        .as("workspace_active");
  }

  /** 술어의 자바 판정판 — 이미 읽어 온 전역 값·멤버십 상태(없으면 null)로 같은 결론을 낸다. */
  public static boolean of(boolean globalActive, String membershipStatus) {
    return globalActive && MembershipRepository.STATUS_ACTIVE.equals(membershipStatus);
  }
}
