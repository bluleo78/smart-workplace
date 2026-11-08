package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.AgentTemplate;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.auth.exception.InvalidProviderCredentialException;
import com.workplace.auth.service.AgentAccountFitPolicy;
import com.workplace.auth.service.AgentProviders;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.user.repository.UserRepository;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 「맞는 계정」 규칙(WP-1296·1297) — AI 의 실행 방식마다 연결해 둘 수 있는 AI 계정.
 *
 * <ul>
 *   <li>작업 공간(실행 설정 행 있음): 그 템플릿의 계정 하나. 템플릿에 계정 요구가 없거나 템플릿이 사라졌으면 Claude·OpenAI 호환.
 *   <li>내 컴퓨터(EXTERNAL, 행 없음): 무엇이든 — Works 의 계정을 서버도 Pod 도 쓰지 않는다.
 *   <li>기본(INTERNAL): Claude·OpenAI 호환 — 서버가 부를 수 있는 것만.
 * </ul>
 *
 * <p>auth 의 연결 등록(chokepoint)이 {@link AgentAccountFitPolicy} 로 부르고, 실행 설정 저장이 같은 판정으로 맞지 않는 연결을
 * 끊는다. 순환 의존을 피하려고 저장소·레지스트리만 쓴다(서비스를 주입하지 않는다).
 */
@Component
@RequiredArgsConstructor
public class AgentAccountFit implements AgentAccountFitPolicy {

  /** 서버가 부를 수 있는 계정의 화면 이름(오류 문구용) — 이름은 AgentProviders 표 한 곳에서 온다. */
  private static final String SERVER_ACCOUNTS =
      "「"
          + AgentProviders.label(AgentProviders.ANTHROPIC)
          + "」이나 「"
          + AgentProviders.label(AgentProviders.OPENCODE)
          + "」";

  private final AgentRuntimeSettingRepository settings;
  private final AgentTemplateRegistry registry;
  private final UserRepository userRepository;

  @Override
  public void requireFits(long agentUserId, String provider) {
    Optional<AgentRuntimeSettingRepository.Row> row = settings.find(agentUserId);
    if (row.isPresent()) {
      AgentTemplate t = registry.find(row.get().templateName()).orElse(null);
      if (!fits(t, provider)) {
        String account = t == null ? null : t.account();
        throw new InvalidProviderCredentialException(
            account != null
                ? "이 AI 의 실행 템플릿은 「" + AgentProviders.label(account) + "」 계정을 써요 — 그 계정으로 연결해 주세요."
                : "이 실행 템플릿에서는 " + SERVER_ACCOUNTS + " 계정만 쓸 수 있어요.");
      }
      return;
    }
    if (userRepository.isExternalAgent(agentUserId)) return;
    if (!fits(null, provider)) {
      throw new InvalidProviderCredentialException(
          "기본 실행 방식에서는 " + SERVER_ACCOUNTS + " 계정만 쓸 수 있어요 — 실행 방식을 먼저 바꿔 주세요.");
    }
  }

  @Override
  public boolean deliversToPod(long agentUserId, String provider) {
    return AgentProviders.deliversLoginInfo(provider)
        && settings
            .find(agentUserId)
            .flatMap(row -> registry.find(row.templateName()))
            .map(t -> provider.equals(t.account()))
            .orElse(false);
  }

  /**
   * 이 계정이 맞는지 — 「맞는 계정」 판정 한 곳(등록 검사·실행 설정 저장·기본 전환이 함께 쓴다). 템플릿이 계정을 요구하면 그 계정만, 아니면 서버가 쓰는
   * 계정(Claude·OpenAI 호환).
   *
   * @param template 작업 공간 템플릿. null 이면 기본(서버) 방식 — 계정 요구 없는 템플릿·사라진 템플릿도 같은 규칙이다
   */
  public static boolean fits(AgentTemplate template, String provider) {
    String account = template == null ? null : template.account();
    return account != null
        ? account.equals(AgentProviders.normalize(provider))
        : AgentProviders.isServerUsable(provider);
  }

  /**
   * 활성 AI 계정({@code activeProvider})이 이 방식에 맞지 않으면 끊는다(맞으면·없으면 그대로) — 실행 설정 저장과 「기본」 전환이 같은 사슬을 쓴다.
   *
   * @param template 작업 공간 템플릿. null 이면 기본(서버) 방식({@link #fits} 와 같다)
   */
  public static void revokeUnfit(
      AiAgentCredentialService credentials,
      Long callerId,
      long agentId,
      AgentTemplate template,
      Optional<String> activeProvider) {
    activeProvider
        .filter(p -> !fits(template, p))
        .ifPresent(p -> credentials.revoke(callerId, agentId));
  }
}
