package com.workplace.support;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.jooq.DSLContext;
import org.jooq.ExecuteContext;
import org.jooq.ExecuteListener;
import org.jooq.ExecuteListenerProvider;
import org.jooq.impl.DefaultExecuteListenerProvider;

/**
 * 작업 동안 실행된 SQL 문장을 모은다(수·내용) — 「조회 수가 사람·프로젝트 수에 비례하지 않는다」를 지키는 테스트용(WP-1129). 서비스가 쓰는 같은
 * DSLContext 설정에 잠시 세는 리스너를 달고, 끝나면 원래대로 돌린다.
 *
 * <p>같은 설정을 쓰는 다른 스레드(비동기 알림·스케줄러)의 쿼리는 세지 않는다 — 부른 테스트 스레드가 낸 것만. 절대 수를 단언하면 무관한 변경에 깨지므로, 크기만 다른
 * 두 입력의 수가 같은지로 본다.
 */
public final class SqlStatementCounter {

  private SqlStatementCounter() {}

  /** {@code work} 를 돌리는 동안 이 스레드에서 실행된 SQL 문장 수. */
  public static int count(DSLContext dsl, Runnable work) {
    return statements(dsl, work).size();
  }

  /** {@code work} 를 돌리는 동안 이 스레드에서 실행된 SQL 문장(실행 순) — 어떤 조회가 돌았는지까지 볼 때. */
  public static List<String> statements(DSLContext dsl, Runnable work) {
    List<String> sqls = Collections.synchronizedList(new ArrayList<>());
    Thread self = Thread.currentThread();
    ExecuteListener counter =
        new ExecuteListener() {
          @Override
          public void executeStart(ExecuteContext ctx) {
            if (Thread.currentThread() == self) sqls.add(String.valueOf(ctx.sql()));
          }
        };
    ExecuteListenerProvider[] before = dsl.configuration().executeListenerProviders();
    ExecuteListenerProvider[] with = Arrays.copyOf(before, before.length + 1);
    with[before.length] = new DefaultExecuteListenerProvider(counter);
    dsl.configuration().set(with);
    try {
      work.run();
    } finally {
      dsl.configuration().set(before);
    }
    return List.copyOf(sqls);
  }
}
