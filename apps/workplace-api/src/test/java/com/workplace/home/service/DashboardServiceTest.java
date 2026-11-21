package com.workplace.home.service;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.home.dto.DashboardDevice;
import com.workplace.home.dto.DashboardResponse;
import com.workplace.home.dto.DashboardWidgetConfig;
import com.workplace.home.exception.DashboardConflictException;
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
                new DashboardWidgetConfig("priority_quadrant", 5, false)),
            null);
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

  /** WP-1953 409 문구 — 서버 문구가 곧 토스트 문구다. */
  static final String CONFLICT_MESSAGE =
      "다른 곳에서 대시보드 레이아웃이 바뀌었습니다. 최신 레이아웃을 불러왔으니 확인한 뒤 다시 저장해 주세요.";

  private List<DashboardWidgetConfig> layout(String... types) {
    return java.util.Arrays.stream(types).map(t -> new DashboardWidgetConfig(t, 5, false)).toList();
  }

  @Test
  void 처음_GET_은_version_0() {
    long userId = insertUser("dash_v0_" + System.nanoTime());
    assertThat(service.get(userId, DashboardDevice.DESKTOP).version()).isZero();
  }

  @Test
  void 맞는_version_이면_저장되고_version_이_1_오른다() {
    long userId = insertUser("dash_v1_" + System.nanoTime());
    List<DashboardWidgetConfig> w2 = layout("notifications", "my_tasks");
    assertThat(service.save(userId, DashboardDevice.DESKTOP, layout("my_tasks"), 0L).version())
        .isEqualTo(1);
    assertThat(service.save(userId, DashboardDevice.DESKTOP, w2, 1L).version()).isEqualTo(2);
    DashboardResponse got = service.get(userId, DashboardDevice.DESKTOP);
    assertThat(got.version()).isEqualTo(2);
    assertThat(got.widgets().stream().map(DashboardWidgetConfig::type).toList())
        .containsExactly("notifications", "my_tasks");
  }

  @Test
  void 옛_version_이면_409_이고_행은_그대로() {
    long userId = insertUser("dash_old_" + System.nanoTime());
    service.save(userId, DashboardDevice.DESKTOP, layout("my_tasks"), 0L);
    assertThatThrownBy(
            () -> service.save(userId, DashboardDevice.DESKTOP, layout("notifications"), 0L))
        .isInstanceOf(DashboardConflictException.class)
        .hasMessage(CONFLICT_MESSAGE);
    DashboardResponse got = service.get(userId, DashboardDevice.DESKTOP);
    assertThat(got.version()).isEqualTo(1);
    assertThat(got.widgets().stream().map(DashboardWidgetConfig::type).toList())
        .containsExactly("my_tasks");
  }

  @Test
  void version_없으면_검사_없이_저장() {
    long userId = insertUser("dash_nov_" + System.nanoTime());
    service.save(userId, DashboardDevice.DESKTOP, layout("my_tasks"), null);
    DashboardResponse second =
        service.save(userId, DashboardDevice.DESKTOP, layout("notifications"), null);
    assertThat(second.version()).isEqualTo(2);
    assertThat(service.get(userId, DashboardDevice.DESKTOP).version()).isEqualTo(2);
  }

  @Test
  void 기기별_version_은_독립() {
    long userId = insertUser("dash_dev_" + System.nanoTime());
    service.save(userId, DashboardDevice.MOBILE, layout("my_tasks"), 0L);
    service.save(userId, DashboardDevice.MOBILE, layout("my_tasks"), 1L);
    assertThat(service.get(userId, DashboardDevice.MOBILE).version()).isEqualTo(2);
    assertThat(service.get(userId, DashboardDevice.DESKTOP).version()).isZero();
  }
}
