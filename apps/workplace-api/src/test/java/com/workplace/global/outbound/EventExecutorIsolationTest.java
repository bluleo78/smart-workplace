package com.workplace.global.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.domain.JavaMethod;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.annotation.Async;

/**
 * WP-1812 — 이벤트 발사 풀({@code aiAgentEventExecutor})이 짧은 발사만 맡고, 오래 붙잡는 메일·계정 작업은 전용 실행기를 쓰는지 정적으로
 * 검증한다.
 */
class EventExecutorIsolationTest {

  /** {@code @Async("aiAgentEventExecutor")} 를 달 수 있는 클래스 — 짧은 발사 디스패처뿐이다. */
  private static final Set<String> ALLOWED_EVENT_EXECUTOR_USERS =
      Set.of(
          "IssueEventDispatcher",
          "ChatEventDispatcher",
          "MessagingAiDispatcher",
          // WP-1818 이 이 항목을 뺀다(메시징 어텐션 분류는 오래 붙잡는 일이라 전용 실행기로 옮긴다).
          "MessagingAttentionService");

  private static String asyncValue(String className, String methodName) throws Exception {
    Class<?> type = Class.forName(className);
    for (Method m : type.getDeclaredMethods()) {
      if (m.getName().equals(methodName) && m.isAnnotationPresent(Async.class)) {
        return m.getAnnotation(Async.class).value();
      }
    }
    throw new AssertionError(className + "." + methodName + " 에 @Async 가 없다");
  }

  @Test
  void longRunningWorkDoesNotUseEventExecutor() throws Exception {
    assertThat(
            asyncValue(
                "com.workplace.mail.service.MailSummaryBackfillService", "summarizeRecentUnread"))
        .isEqualTo("mailAnalysisExecutor");
    assertThat(asyncValue("com.workplace.mail.service.MailBackfillService", "backfill"))
        .isEqualTo("mailAnalysisExecutor");
    assertThat(
            asyncValue(
                "com.workplace.mail.service.MailClassifyBackfillService", "classifyRecentUnread"))
        .isEqualTo("mailAnalysisExecutor");

    String sync = "mailAccountSyncExecutor";
    for (String cls :
        Arrays.asList(
            "com.workplace.mail.outbound.MailAccountSyncDispatcher",
            "com.workplace.mail.outbound.AccountPurgeDispatcher",
            "com.workplace.calendar.service.CalendarAccountSyncDispatcher")) {
      Method handler =
          Arrays.stream(Class.forName(cls).getDeclaredMethods())
              .filter(m -> m.isAnnotationPresent(Async.class))
              .findFirst()
              .orElseThrow(() -> new AssertionError(cls + " 에 @Async 핸들러가 없다"));
      assertThat(handler.getAnnotation(Async.class).value()).as(cls).isEqualTo(sync);
    }
  }

  @Test
  void aiAgentEventExecutorUsersAreDispatchersOnly() {
    JavaClasses classes =
        new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("com.workplace");
    Set<String> users =
        classes.stream()
            .flatMap(c -> c.getMethods().stream())
            .filter(EventExecutorIsolationTest::usesEventExecutor)
            .map(m -> m.getOwner().getSimpleName())
            .collect(Collectors.toSet());
    assertThat(users).isNotEmpty().isSubsetOf(ALLOWED_EVENT_EXECUTOR_USERS);
  }

  private static boolean usesEventExecutor(JavaMethod m) {
    return m.tryGetAnnotationOfType(Async.class)
        .map(a -> "aiAgentEventExecutor".equals(a.value()))
        .orElse(false);
  }
}
