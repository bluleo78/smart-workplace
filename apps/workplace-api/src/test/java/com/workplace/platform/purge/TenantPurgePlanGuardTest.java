package com.workplace.platform.purge;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.jooq.Table;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** 영구 삭제 목록이 스키마와 어긋나지 않게 지키는 가드. 새 테넌트 테이블을 만들고 TenantPurgePlan 에 넣지 않으면 실패한다. */
class TenantPurgePlanGuardTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;

  private static Set<String> planNames() {
    return TenantPurgePlan.ORDER.stream().map(Table::getName).collect(Collectors.toSet());
  }

  @Test
  void everyTenantTable_isInPlanOrExcluded() {
    Set<String> catalog = new HashSet<>(TenantPurgePlan.tenantTableNames(dsl));
    Set<String> covered = new HashSet<>(planNames());
    covered.addAll(TenantPurgePlan.EXCLUDED);
    assertThat(covered).as("TenantPurgePlan 에 빠진/남는 테이블").isEqualTo(catalog);
  }

  @Test
  void runtimeRole_canDeleteEveryPlanTable() {
    // V46 처럼 app_tenant 의 DELETE 를 REVOKE 한 테이블이 목록에 있으면 런타임에 실패한다.
    for (String t : planNames()) {
      Boolean ok =
          dsl.fetchSingle("SELECT has_table_privilege('app_tenant', {0}, 'DELETE')", DSL.inline(t))
              .get(0, Boolean.class);
      assertThat(ok).as("app_tenant DELETE 권한: " + t).isTrue();
    }
  }

  @Test
  void noActionOrRestrictFks_childBeforeParent() {
    List<String> order = TenantPurgePlan.ORDER.stream().map(Table::getName).toList();
    // confdeltype: a=NO ACTION, r=RESTRICT (c=CASCADE, n=SET NULL, d=SET DEFAULT 는 순서 무관)
    var rows =
        dsl.fetch(
            "SELECT ch.relname AS child, pa.relname AS parent FROM pg_constraint k "
                + "JOIN pg_class ch ON ch.oid = k.conrelid JOIN pg_class pa ON pa.oid = k.confrelid "
                + "WHERE k.contype = 'f' AND k.confdeltype IN ('a','r') AND ch.oid <> pa.oid");
    // 쿼리가 조용히 0행을 돌려주면(카탈로그 조건 오타 등) 아래 검사가 공허하게 통과한다 — 최소 1행은 있어야 한다.
    assertThat(rows).as("NO ACTION/RESTRICT FK 조회 결과").isNotEmpty();
    for (var r : rows) {
      String child = r.get("child", String.class);
      String parent = r.get("parent", String.class);
      if (order.contains(child) && order.contains(parent)) {
        assertThat(order.indexOf(child))
            .as(child + " 는 " + parent + " 보다 먼저 지워야 한다")
            .isLessThan(order.indexOf(parent));
      }
    }
  }
}
