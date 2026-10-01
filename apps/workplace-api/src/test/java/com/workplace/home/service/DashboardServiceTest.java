package com.workplace.home.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.home.dto.DashboardDevice;
import com.workplace.home.dto.DashboardResponse;
import com.workplace.home.dto.DashboardWidgetConfig;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 대시보드 기본 레이아웃과 시스템 위젯 화이트리스트 테스트. */
@Transactional
class DashboardServiceTest extends IntegrationTestBase {

  @Autowired DashboardService service;
  @Autowired DSLContext dsl;

  private long insertUser(String username) {
    return dsl.insertInto(USER)
        .set(USER.USERNAME, username)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, username)
        .set(USER.EMAIL, username + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void 기본_레이아웃은_synthesis_quick_actions를_맨앞에_포함하고_priority_quadrant는_제외한다() {
    long userId = insertUser("dashboard_test_" + System.nanoTime());
    DashboardResponse res = service.get(userId, DashboardDevice.DESKTOP); // 저장된 레이아웃 없는 신규 사용자
    List<String> types = res.widgets().stream().map(DashboardWidgetConfig::type).toList();
    // priority_quadrant 는 기본 레이아웃에 없음(사용자가 "위젯 추가"로 직접 넣어야 함).
    assertThat(types)
        .containsExactly(
            "synthesis",
            "quick_actions",
            "my_tasks",
            "calendar_today",
            "notifications",
            "recent_chats",
            "unread_mail");
  }

  @Test
  void 신규_시스템_위젯_3종은_화이트리스트에_포함되어_저장_가능하다() {
    long userId = insertUser("dashboard_save_test_" + System.nanoTime());
    DashboardResponse saved =
        service.save(
            userId,
            DashboardDevice.DESKTOP,
            List.of(
                new DashboardWidgetConfig("synthesis", 5, false),
                new DashboardWidgetConfig("quick_actions", 5, false),
                new DashboardWidgetConfig("priority_quadrant", 5, false)));
    assertThat(saved.widgets()).hasSize(3);
  }

  @Test
  void 모바일_기본_레이아웃은_핵심_6종을_count3_펼침으로_반환한다() {
    long userId = insertUser("dashboard_mobile_test_" + System.nanoTime());
    DashboardResponse res = service.get(userId, DashboardDevice.MOBILE);
    assertThat(res.widgets().stream().map(DashboardWidgetConfig::type).toList())
        .containsExactly(
            "synthesis",
            "my_tasks",
            "calendar_today",
            "notifications",
            "unread_mail",
            "recent_chats");
    assertThat(res.widgets())
        .allSatisfy(
            w -> {
              assertThat(w.count()).isEqualTo(3);
              assertThat(w.collapsed()).isFalse();
              assertThat(w.hidden()).isFalse();
            });
  }
}
