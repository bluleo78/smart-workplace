package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.AgentPaneReportRequest;
import com.workplace.agentruntime.outbound.AgentRuntimeChangeNotifier;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.tenant.TenantContext;
import java.time.OffsetDateTime;
import java.util.Objects;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 칸 차단 보고 서비스(WP-1913) — Pod 안 진입점이 칸을 띄우지 못하면(설정·로그인 오류 등) 이유를 실행 설정의 pane_blocked_* 칸에 남겨 관리자 화면이
 * 「오류」+이유를 보여 주게 한다. runner 관찰 보고가 쓰는 칸과 분리해 저장하고, 읽을 때만 합친다(덮어쓰기 없음 — runner 보고와 겹치지 않는다).
 *
 * <p>보고는 최선 노력이다 — 워크스페이스가 정해지지 않았거나 실행 설정이 없는 AI(외부 실행)는 조용히 끝낸다(진입점은 보고 실패로 멈추지 않는다). 본문이 잘못됐을 때만
 * 400 으로 알려 준다(호출 스크립트 버그). 호출자가 AI 인지는 컨트롤러가 인증 권한으로 먼저 확인한다.
 *
 * <p>칸 차단은 읽을 때만 합치므로 VisibleRuntimeState 가 잡지 못한다 — 그래서 저장한 메시지가 실제로 바뀔 때만 관리자 화면 실시간 알림을 보내, 이미
 * 열려 있는 화면이 「오류」+사유를 놓치지 않는다(WP-1913).
 */
@Service
@Transactional
@RequiredArgsConstructor
public class AgentPaneReportService {

  private final AgentRuntimeSettingRepository settings;
  private final AgentRuntimeChangeNotifier changeNotifier;

  /**
   * 칸 차단 보고 처리. 순서: 본문 검증(state 는 BLOCKED·OK 만) → 메시지에서 제어 문자 정제(아래 {@link #sanitizeMessage} — 정제 뒤
   * 공백뿐이면 400) → 테넌트 없으면 조용히 return → 설정 행을 잠가 읽고(없으면 조용히 return) message·시각 기록 → OK 면 칸 비움 → 저장한
   * 메시지가 바뀌었으면 관리자 화면에 알림.
   *
   * <p>500자 상한은 매개변수 바인딩({@code @Size})에서 이미 먼저 검증된다 — 검증을 통과한 값을 정제하므로, 정제가 길이를 늘리지 않는 한 500자를 넘는
   * 값은 저장될 수 없고, 정제는 제어 문자를 같은 수의 공백으로 바꾸고 앞뒤를 떼기만 하므로 길이가 늘지 않는다.
   */
  public void report(long userId, AgentPaneReportRequest req) {
    // jakarta validation 은 조건부 필수(BLOCKED 일 때만 message)를 표현할 수 없어 여기서 검증한다.
    boolean blocked = "BLOCKED".equals(req.state());
    if (!blocked && !"OK".equals(req.state())) {
      throw new IllegalArgumentException("state 는 BLOCKED 또는 OK 여야 합니다");
    }
    // 저장 전에 제어 문자를 정제한다 — 정제 뒤 공백만 남으면 이유가 없는 차단이라 원래 공백 메시지와 같이 400.
    String message = sanitizeMessage(req.message());
    if (blocked && (message == null || message.isBlank())) {
      throw new IllegalArgumentException("차단 보고에는 이유(message)가 필요합니다");
    }
    // 보고는 최선 노력 — 워크스페이스·실행 설정이 없으면 조용히 끝낸다(기존 AgentStatusReportService 와 동일).
    if (TenantContext.get() == null) return;
    Optional<Row> locked = settings.findForUpdate(userId);
    if (locked.isEmpty()) return;
    Row before = locked.get();
    // OK 는 칸 비움(null) — BLOCKED 는 이유와 지금 시각을 함께 기록한다.
    String nextMessage = blocked ? message : null;
    settings.updatePaneBlocked(userId, nextMessage, blocked ? OffsetDateTime.now() : null);
    // 화면에 보이는 것(「오류」+사유)이 실제로 바뀔 때만 알린다 — 같은 메시지의 거듭된 보고(진입점 재시도)는
    // paneBlockedAt 만 갱신할 뿐 화면이 그대로라 알리지 않는다(변경 알림 계약: 바뀐 것이 없으면 보지 않는다).
    if (!Objects.equals(before.paneBlockedMessage(), nextMessage)) {
      changeNotifier.agentChanged(ResourceChangedEvent.OP_UPDATED, userId, null);
    }
  }

  /**
   * 차단 메시지의 제어 문자(개행·탭·NUL 등)를 공백으로 바꾸고 앞뒤 공백을 뗀다(WP-1913) — 진입점은 로그 한 줄을 그대로 실으므로 개행이 섞이면 관리자 화면의
   * 사유 한 줄이 여러 줄로 갈라지고, NUL 은 PostgreSQL 이 거절해 보고 전체가 실패한다(테스트가 막는 바). gw-boot 의 {@code tr}·{@code
   * sed} 와 같은 취향을 서버가 마지막으로 방어한다 — 클라이언트 정제를 믿지 않고, 그 밖의 남은 제어 문자도 같은 방식으로 정리한다.
   *
   * @param message 보고 온 원문 — null 은 그대로 null(OK 보고에는 message 가 없다)
   * @return 제어 문자를 공백으로 바꾸고 앞뒤를 뗀 값(길이는 원문 이하 — 공백 치환은 1:1, trim 은 줄이기만 한다)
   */
  private static String sanitizeMessage(String message) {
    if (message == null) return null;
    StringBuilder sanitized = new StringBuilder(message.length());
    for (int i = 0; i < message.length(); i++) {
      char c = message.charAt(i);
      sanitized.append(Character.isISOControl(c) ? ' ' : c);
    }
    return sanitized.toString().trim();
  }
}
