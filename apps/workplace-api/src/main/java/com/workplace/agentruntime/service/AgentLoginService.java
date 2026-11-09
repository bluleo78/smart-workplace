package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.AgentLoginResponse;
import com.workplace.agentruntime.exception.AgentLoginNotFoundException;
import com.workplace.agentruntime.exception.AgentLoginRejectedException;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.auth.service.AgentProviders;
import com.workplace.auth.service.PodAccountSource;
import com.workplace.auth.service.PodAccountSource.BoundLogin;
import com.workplace.auth.service.PodAccountSource.LoginUploadOutcome;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Pod 용 로그인 받기·올리기(WP-1450) — 서버가 갱신한 로그인을 Pod 가 AI 키로 받아 가고, Pod 가 스스로 갱신한 더 새 로그인을 올린다. 묶인 계정이 이
 * AI 의 실행 템플릿과 맞을 때만 열린다(desired 의 login 참조와 같은 판정 — 안 맞으면 runner 도 로그인을 안 준다).
 */
@Service
@RequiredArgsConstructor
public class AgentLoginService {

  private final AgentRuntimeSettingRepository settings;
  private final AgentTemplateRegistry registry;
  private final PodAccountSource podAccounts;

  /**
   * 묶인 로그인 — 템플릿에 맞는 genia·chatgpt 계정이 없으면 404. {@code revision} 이 서버의 현재 번호와 같으면 원문을 복호화하지 않고
   * empty(바뀐 것 없음 — 호출자가 204)로 끝낸다: Pod 가 5분마다 묻는 흔한 경우라 복호화를 아낀다. 묶음·계정은 한 번만 읽고(번호 비교와 원문을 같은
   * 행에서), 템플릿 판정도 한 번만 한다.
   */
  @Transactional(readOnly = true)
  public Optional<AgentLoginResponse> get(long agentUserId, Long revision) {
    BoundLogin login =
        podAccounts
            .findBoundLogin(agentUserId, revision)
            .orElseThrow(AgentLoginNotFoundException::new);
    requireFits(agentUserId, login.provider());
    if (login.unchanged()) return Optional.empty();
    return Optional.of(
        new AgentLoginResponse(
            login.version(), login.revision(), login.provider(), login.payload()));
  }

  /** Pod 가 올린 로그인을 저장한다 — 안 묶였으면 404, 받지 않는 이유가 있으면 409(이유 코드). */
  @Transactional
  public void upload(long agentUserId, long version, String payload) {
    String provider =
        podAccounts.findBoundProvider(agentUserId).orElseThrow(AgentLoginNotFoundException::new);
    requireFits(agentUserId, provider);
    LoginUploadOutcome outcome = podAccounts.uploadBoundLogin(agentUserId, version, payload);
    switch (outcome) {
      case SAVED -> {}
      case NOT_BOUND -> throw new AgentLoginNotFoundException();
      default -> throw new AgentLoginRejectedException(outcome.name());
    }
  }

  /** 이 AI 의 템플릿이 로그인 계정을 요구하고 그 종류가 {@code provider} 와 맞아야 한다 — 아니면 404(묶이지 않은 것과 같다). */
  private void requireFits(long agentUserId, String provider) {
    boolean fits =
        settings
            .find(agentUserId)
            .flatMap(row -> registry.find(row.templateName()))
            .filter(t -> AgentProviders.deliversLoginInfo(t.account()))
            .filter(t -> AgentAccountFit.fits(t, provider))
            .isPresent();
    if (!fits) throw new AgentLoginNotFoundException();
  }
}
