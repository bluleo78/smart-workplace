package com.workplace.mail.service;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.exception.MailAiException;
import com.workplace.mail.exception.MailAiUnavailableException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * 메일 분석 백필 전용 프로세스 단위 회로 차단기(WP-1812).
 *
 * <p>공유 모델이 멈췄을 때 백필 루프가 같은 메일을 계속 다시 시도해 모델을 더 몰아붙이는 일을 막는다. 두 겹이다.
 *
 * <ul>
 *   <li>전역: 모델 실패({@link com.workplace.mail.exception.MailAiException})가 연속 {@link
 *       #MAX_CONSECUTIVE_FAILURES}회면 {@link #OPEN_DURATION} 동안 열려 백필 루프가 쉰다.
 *   <li>메일별: 실패한 메일은 {@link #MESSAGE_BACKOFF} 동안 건너뛴다(같은 메일 반복 시도 방지).
 * </ul>
 *
 * 연속 실패 수·열림 상태는 테넌트별이다(현재 {@link TenantContext}, 없으면 하나의 기본 키) — 한 테넌트의 모델 문제가 다른 테넌트의 백필을 쉬게 하지
 * 않는다. 비서별까지는 나누지 않는다. 메일별 표는 (테넌트, 메일 id) 키라 테넌트 간 id 가 겹쳐도 섞이지 않는다.
 *
 * <p>백필 루프에서만 쓴다. 열람 시 요약처럼 사용자 요청 경로는 이 차단기를 보지 않는다. 여러 실행기 스레드가 함께 쓰므로 모든 상태 접근은 동기화한다.
 */
@Slf4j
@Component
public class MailAnalysisBreaker {

  /** 회로를 여는 연속 실패 수. */
  public static final int MAX_CONSECUTIVE_FAILURES = 5;

  /** 회로가 열려 있는 시간. */
  public static final Duration OPEN_DURATION = Duration.ofMinutes(10);

  /** 실패한 메일을 건너뛰는 시간. */
  public static final Duration MESSAGE_BACKOFF = Duration.ofMinutes(30);

  /** 메일별 건너뜀 표의 최대 크기 — 메모리가 무한히 늘지 않게 한다. */
  public static final int MAX_TRACKED_MESSAGES = 10_000;

  /** 테넌트 컨텍스트가 없을 때(테스트·컨텍스트 밖 호출)의 기본 키. */
  private static final long NO_TENANT = -1L;

  private final Clock clock;

  /** (테넌트, 메일 id) → 건너뜀 해제 시각. 최대 크기는 전체 합계로 센다. */
  private final Map<MessageKey, Instant> skipUntil = new HashMap<>();

  /** 테넌트 → 연속 실패 수·열림 상태. */
  private final Map<Long, TenantState> tenants = new HashMap<>();

  /** 메일별 표의 키. */
  private record MessageKey(long tenant, long messageId) {}

  /** 테넌트 하나의 회로 상태. */
  private static final class TenantState {
    int consecutiveFailures;
    Instant openUntil = Instant.MIN;
  }

  /** 스프링용 기본 생성자 — 시스템 시계. */
  @Autowired
  public MailAnalysisBreaker() {
    this(Clock.systemUTC());
  }

  /** 테스트용 — 시계를 주입한다. */
  MailAnalysisBreaker(Clock clock) {
    this.clock = clock;
  }

  /**
   * 이 예외가 회로가 세는 모델 실패인지 — 백필 루프 네 곳이 같은 기준을 쓰도록 한곳에 둔다. {@link MailAiException}(응답 실패)과, 사유 코드가 없는
   * 503({@link MailAiUnavailableException} — ai-agent 재기동 등 일시 불가)만 센다. AI 꺼짐·비서 미설정 같은 영구 사유는 계정
   * 설정 문제라 세지 않는다 — 세면 다른 계정의 백필까지 쉬게 된다.
   *
   * <p>{@link MailAiException#isAgentUnavailable} 와의 차이: 그쪽은 agent 불가만 가려 연속 불가 멈춤({@code
   * AgentOutageGuard})에 쓰므로 사유 코드가 있는 503 까지 불가로 보고 {@link MailAiException} 은 일시 장애(연결·타임아웃)만 본다.
   * 이쪽은 반대로 {@link MailAiException} 전반(파싱 실패 등 응답은 왔으나 실패한 모델 오류 포함)을 세고, 503 은 사유 코드 없는 일시 불가만 센다.
   */
  public static boolean countsAsModelFailure(Throwable e) {
    return e instanceof MailAiException
        || (e instanceof MailAiUnavailableException u && u.code() == null);
  }

  private static long currentTenant() {
    Long t = TenantContext.get();
    return t == null ? NO_TENANT : t;
  }

  private TenantState stateOf(long tenant) {
    return tenants.computeIfAbsent(tenant, k -> new TenantState());
  }

  /** 백필 루프가 메일 하나를 처리하기 전에 받는 입장 판정 — {@link #admit}. */
  public enum Admission {
    /** 회로가 열려 있다 — 루프는 남은 메일을 건드리지 않고 끝낸다. */
    OPEN,
    /** 그 메일이 실패 뒤 건너뜀 시간 안이다 — 이 메일만 건너뛴다. */
    SKIP,
    /** 처리해도 된다. */
    GO
  }

  /**
   * 메일 하나를 처리해도 되는지 한 번에 판정한다(한 번의 잠금·시계·테넌트 읽기). 회로가 열려 있으면(열림 시각 안이면) {@link Admission#OPEN}, 그
   * 메일이 실패 뒤 건너뜀 시간 안이면 {@link Admission#SKIP}, 아니면 {@link Admission#GO}. 만료된 건너뜀 항목은 그 자리에서 치운다.
   * 열림이 건너뜀보다 먼저 판정된다(열려 있으면 메일별 표는 보지 않는다).
   */
  public synchronized Admission admit(long messageId) {
    long tenant = currentTenant();
    Instant now = clock.instant();
    TenantState st = tenants.get(tenant);
    if (st != null && now.isBefore(st.openUntil)) {
      return Admission.OPEN;
    }
    MessageKey key = new MessageKey(tenant, messageId);
    Instant until = skipUntil.get(key);
    if (until == null) {
      return Admission.GO;
    }
    if (now.isBefore(until)) {
      return Admission.SKIP;
    }
    skipUntil.remove(key);
    return Admission.GO;
  }

  /**
   * 메일 처리 중 예외가 났을 때 호출한다 — 모델 실패({@link #countsAsModelFailure})면 {@link #recordFailure} 로 센다. IMAP
   * 본문 적재 실패 같은 모델 상태와 무관한 예외는 세지 않는다.
   */
  public void onError(long messageId, Throwable e) {
    if (countsAsModelFailure(e)) {
      recordFailure(messageId);
    }
  }

  /** 모델이 응답했다 — 현재 테넌트의 연속 실패 수만 0 으로 되돌린다(다른 테넌트의 수는 그대로). */
  public synchronized void recordSuccess() {
    TenantState st = tenants.get(currentTenant());
    if (st != null) {
      st.consecutiveFailures = 0;
    }
  }

  /**
   * 모델 실패를 기록한다 — 현재 테넌트의 연속 수를 올리고 그 메일을 건너뜀 표에 올린다. {@link #MAX_CONSECUTIVE_FAILURES}회째면 그 테넌트의
   * 회로를 열고 경고를 한 번 남긴다(연속 수는 0 으로 되돌려, 닫힌 뒤 다시 5회가 쌓여야 열린다).
   */
  public synchronized void recordFailure(long messageId) {
    Instant now = clock.instant();
    long tenant = currentTenant();
    MessageKey key = new MessageKey(tenant, messageId);
    if (skipUntil.size() >= MAX_TRACKED_MESSAGES && !skipUntil.containsKey(key)) {
      evict(now);
    }
    skipUntil.put(key, now.plus(MESSAGE_BACKOFF));
    TenantState st = stateOf(tenant);
    st.consecutiveFailures++;
    if (st.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      st.openUntil = now.plus(OPEN_DURATION);
      st.consecutiveFailures = 0;
      log.warn(
          "메일 분석 회로 열림 (tenant={}) — 모델 실패 {}회 연속, {}분간 백필을 쉰다",
          tenant,
          MAX_CONSECUTIVE_FAILURES,
          OPEN_DURATION.toMinutes());
    }
  }

  /** 표가 가득 찼을 때 자리를 만든다 — 만료 항목을 먼저 치우고, 그래도 가득이면 해제 시각이 가장 이른(가장 오래된) 항목을 버린다. */
  private void evict(Instant now) {
    skipUntil.values().removeIf(until -> !now.isBefore(until));
    if (skipUntil.size() < MAX_TRACKED_MESSAGES) {
      return;
    }
    skipUntil.entrySet().stream()
        .min(Map.Entry.comparingByValue())
        .map(Map.Entry::getKey)
        .ifPresent(skipUntil::remove);
  }

  /** 테스트용 — 건너뜀 표 크기. */
  synchronized int trackedMessageCount() {
    return skipUntil.size();
  }
}
