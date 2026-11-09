package com.workplace.agentaccount.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentaccount.dto.AgentAccountRow;
import com.workplace.agentaccount.repository.AgentAccountBindingRepository;
import com.workplace.agentaccount.repository.AgentAccountBindingRepository.Binding;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.agentruntime.dto.AgentTemplate;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.service.AgentAccountFit;
import com.workplace.agentruntime.service.AgentTemplateRegistry;
import com.workplace.auth.dto.ActiveCredentialRef;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.service.AgentAccountFitPolicy;
import com.workplace.auth.service.AgentProviders;
import com.workplace.auth.service.AiAgentCredentialService.ActiveProviderSecret;
import com.workplace.auth.service.OpencodeLoginInfo;
import com.workplace.auth.service.PodAccountSource;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.util.Texts;
import com.workplace.user.dto.AgentUsernames;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link PodAccountSource} 구현(WP-1448) — 작업 공간 AI 가 묶인 계정을 runner
 * 계약(desired·/secrets/claude·/secrets/login)에 넘긴다. 버전은 계정의 secret_version 이다(원문을 교체하면 바뀌고, 같은 계정을
 * 쓰는 AI 들은 같은 값을 받는다) — 단 이관 백필로 묶인 AI 는 원문이 그대로인 동안 옛 연결 id 를 이어받는다({@link #versionId}). 폐기된 계정은
 * 보이지 않아 묶이지 않은 것과 같다.
 *
 * <p>쓰기 창구도 여기 있다 — auth(기존 연결 등록 다리)·agentruntime(실행 방식 전환)은 agentaccount 를 import 하지 않으므로 이 구현을
 * 거쳐 {@link AgentAccountBindingService} 의 묶기·풀기(감사 로그·runner 알림 포함)를 그대로 쓴다.
 */
@Slf4j
@Component
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class AgentAccountPodSource implements PodAccountSource {

  /** 계정 라벨 칸 길이(V274 label VARCHAR(80)). */
  private static final int LABEL_MAX = 80;

  /** 기존 연결 등록으로 만든 계정의 기본 라벨 꼬리 — 「<AI 이름> 계정」. */
  private static final String LABEL_SUFFIX = " 계정";

  private final AgentAccountBindingRepository bindings;
  private final AgentAccountRepository accounts;
  private final EncryptionService encryptionService;
  private final AgentAccountService accountService;
  private final AgentAccountBindingService bindingService;
  private final AgentRuntimeSettingRepository settings;
  private final UserRepository userRepository;
  private final AgentTemplateRegistry registry;
  private final AgentAccountFitPolicy accountFit;
  private final AssistantConfigRepository configRepo;
  private final ObjectMapper objectMapper;

  /** 묶음·계정을 한 번씩 몰아 읽는다(AI 마다 조회하지 않게). 버전 자리는 {@link #versionId} 다. */
  @Override
  public Map<Long, ActiveCredentialRef> findBoundRefs(Collection<Long> agentUserIds) {
    Map<Long, Binding> bound = bindings.findBindings(agentUserIds);
    if (bound.isEmpty()) return Map.of();
    Map<Long, AgentAccountRow> rows =
        accounts.findActiveByIds(bound.values().stream().map(Binding::accountId).toList());
    Map<Long, ActiveCredentialRef> out = new HashMap<>();
    bound.forEach(
        (agentId, binding) -> {
          AgentAccountRow row = rows.get(binding.accountId());
          if (row != null) {
            out.put(agentId, new ActiveCredentialRef(versionId(binding, row), row.provider()));
          }
        });
    return out;
  }

  /**
   * 묶인 계정 원문 — id 자리는 desired 와 같은 {@link #versionId}(/secrets/claude·/secrets/login 의 version 이
   * desired 와 맞게).
   */
  @Override
  public Optional<ActiveProviderSecret> findBoundSecret(long agentUserId) {
    return bindings
        .findBinding(agentUserId)
        .flatMap(
            binding ->
                accounts
                    .findActive(binding.accountId())
                    .map(
                        row ->
                            new ActiveProviderSecret(
                                versionId(binding, row),
                                row.provider(),
                                encryptionService.decrypt(row.encryptedSecret()))));
  }

  /**
   * 묶인 계정의 login 버전을 한 번에(runner desired). 묶음·계정·지정 모델을 각각 한 쿼리로 읽고, OpenCode 계정만 AI 마다 원문을 복호화해
   * {@link OpencodeLoginInfo#toPod} 로 계산한다 — 활성 연결 쪽({@code
   * AiAgentCredentialService.podLoginVersions})과 같은 함수·같은 매퍼라 {@code /secrets/login} 의 version 과
   * 같다.
   *
   * <p>AI 하나의 원문을 읽지 못하면 이 본문 안에서 잡아 그 AI 만 뺀다. 복호화({@link EncryptionService})·계산({@link
   * OpencodeLoginInfo})은 트랜잭션 프록시가 아니므로 예외가 어떤 참여 트랜잭션 경계도 넘지 않는다 — 넘으면 runner desired 트랜잭션이
   * rollback-only 로 표시돼, 잡아도 커밋 때 위치 전체가 500 이 된다.
   */
  @Override
  public Map<Long, Long> findBoundPodLoginVersions(Map<Long, ActiveCredentialRef> refs) {
    Map<Long, Long> out = new HashMap<>();
    List<Long> opencodeIds = new ArrayList<>();
    refs.forEach(
        (agentId, ref) -> {
          if (AgentProviders.OPENCODE.equals(ref.provider())) opencodeIds.add(agentId);
          else out.put(agentId, ref.id());
        });
    if (opencodeIds.isEmpty()) return out;
    Map<Long, Binding> bound = bindings.findBindings(opencodeIds);
    Map<Long, AgentAccountRow> rows =
        accounts.findActiveByIds(bound.values().stream().map(Binding::accountId).toList());
    Map<Long, String> models = configRepo.findModels(opencodeIds);
    bound.forEach(
        (agentId, binding) -> {
          AgentAccountRow row = rows.get(binding.accountId());
          // 참조를 읽은 뒤 계정이 폐기됐거나 종류가 바뀌었으면 login 버전 없음(묶이지 않은 것과 같다).
          if (row == null || !AgentProviders.OPENCODE.equals(row.provider())) return;
          try {
            String plaintext = encryptionService.decrypt(row.encryptedSecret());
            out.put(
                agentId,
                OpencodeLoginInfo.toPod(
                        objectMapper, versionId(binding, row), plaintext, models.get(agentId))
                    .version());
          } catch (RuntimeException e) {
            // 원문·암호문·예외 메시지는 싣지 않는다 — 값이 섞일 수 있다.
            log.warn(
                "묶인 OpenAI 호환 계정 원문을 읽지 못해 login version 을 뺍니다: agentUserId={} accountId={} ({})",
                agentId,
                row.id(),
                e.getClass().getSimpleName());
          }
        });
    return out;
  }

  /**
   * AI 의 runner 버전 원천 id — 이관 백필이 남긴 옛 연결 id 가 있고 계정 secret_version 이 그때 그대로면 그 옛 연결 id, 아니면 계정
   * secret_version. claude 버전·genia/chatgpt login 버전·OpenCode login 버전 계산의 id 입력이 모두 이 값이라, 이관 전 옛
   * 연결 경로가 내던 버전과 똑같다(이관된 Pod 가 다시 만들어지지 않는다). 원문을 교체하면 secret_version 이 바뀌어 계정 버전으로 넘어간다(사람이 의도한
   * 변경 → Pod 교체).
   */
  static long versionId(Binding binding, AgentAccountRow row) {
    Long override = binding.versionIdOverride();
    if (override != null
        && Long.valueOf(row.secretVersion()).equals(binding.overrideSecretVersion())) {
      return override;
    }
    return row.secretVersion();
  }

  /**
   * Pod AI(실행 설정 행 있음)·개인 비서 아님일 때만 계정을 찾거나 만들어 묶는다. 라벨이 비면 「<AI 이름> 계정」 — 이관 백필과 같은 기본값.
   *
   * <p>다리는 연결 등록을 깨지 않는다 — 실행 템플릿이 사라졌거나 그 템플릿에 이 계정이 맞지 않으면 계정을 만들지 않고 있던 묶음만 푼다(runner 가 방금 쓴 연결
   * 행으로 돌아가게). 묶기 서비스에서 거절되게 두면 트랜잭션이 롤백 표시돼 연결 등록까지 깨지므로, 묶기 전에 같은 규칙({@link
   * AgentAccountFit#fits})으로 먼저 본다. 그 밖의 예상하지 못한 오류는 그대로 올려 등록 전체를 롤백한다.
   *
   * <p>OpenAI 호환 원문의 Pod 꼴 검사는 연결 등록과 같은 값({@link AgentAccountFitPolicy#deliversToPod})으로 한다 — 연결
   * 등록이 받아들인 값을 다리가 400 으로 깨지 않게.
   */
  @Override
  @Transactional
  public void bindFromLegacy(
      Long callerId, long agentUserId, String provider, String normalizedPlaintext, String label) {
    // 실행 설정 행을 먼저 잠근다 — 아래 계정 찾기·만들기가 계정 행을 고칠(키 교체) 수 있어, 묶기({@link
    // AgentAccountBindingService})와 같은 「설정 행 → 계정 행」 순서를 지켜 동시 묶기와 교착하지 않게.
    Optional<AgentRuntimeSettingRepository.Row> setting = settings.findForUpdate(agentUserId);
    if (setting.isEmpty()) return;
    UserResponse agent = userRepository.findById(agentUserId).orElse(null);
    if (agent == null || AgentUsernames.isPersonalAssistant(agent.username())) return;
    AgentTemplate template = registry.find(setting.get().templateName()).orElse(null);
    if (template == null || !AgentAccountFit.fits(template, provider)) {
      // 묶을 수 없는 상태 — 옛 묶음이 남으면 runner 가 방금 넣은 연결 대신 옛 계정을 계속 쓰므로 푼다. 비밀값은 로그에 싣지 않는다.
      boolean unbound = bindingService.unbindIfBound(callerId, agentUserId);
      log.info(
          "기존 연결 등록 다리: 계정에 묶지 않음 agentUserId={} provider={} reason={} unbound={}",
          agentUserId,
          provider,
          template == null ? "template_missing" : "unfit",
          unbound);
      return;
    }
    String resolved = Texts.stripToNull(label);
    if (resolved == null) resolved = defaultLabel(agent);
    long accountId =
        accountService.findOrRegisterFromLegacy(
            callerId,
            provider,
            normalizedPlaintext,
            resolved,
            accountFit.deliversToPod(agentUserId, provider));
    bindingService.bindWithoutResponse(callerId, agentUserId, accountId);
  }

  /** 옛 연결에서 만든 계정의 기본 라벨 「<AI 이름> 계정」 — 다리와 이관 백필({@link AgentAccountBackfill})이 같은 값을 쓴다. */
  static String defaultLabel(UserResponse agent) {
    String name = Texts.stripToNull(agent.name());
    if (name == null) name = agent.username();
    // 라벨 칸은 80자 — 긴 AI 이름은 잘라 「 계정」을 붙인다.
    if (name.length() > LABEL_MAX - LABEL_SUFFIX.length()) {
      name = name.substring(0, LABEL_MAX - LABEL_SUFFIX.length());
    }
    return name + LABEL_SUFFIX;
  }

  @Override
  @Transactional
  public boolean unbindIfBound(Long callerId, long agentUserId) {
    return bindingService.unbindIfBound(callerId, agentUserId);
  }
}
