package com.workplace.agentaccount.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentaccount.dto.AgentAccountRow;
import com.workplace.agentaccount.repository.AgentAccountBindingRepository;
import com.workplace.agentaccount.repository.AgentAccountBindingRepository.Binding;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.agentruntime.dto.AgentTemplate;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.service.AgentAccountFit;
import com.workplace.agentruntime.service.AgentRuntimeImmediateInputs;
import com.workplace.agentruntime.service.AgentTemplateRegistry;
import com.workplace.auth.dto.ActiveCredentialRef;
import com.workplace.auth.exception.InvalidProviderCredentialException;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.service.AgentAccountFitPolicy;
import com.workplace.auth.service.AgentProviders;
import com.workplace.auth.service.AiAgentCredentialService.ActiveProviderSecret;
import com.workplace.auth.service.LoginInfoNormalizer;
import com.workplace.auth.service.OpencodeLoginInfo;
import com.workplace.auth.service.PodAccountSource;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.util.Texts;
import com.workplace.user.dto.AgentUsernames;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.time.Instant;
import java.time.ZoneOffset;
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
  private final AgentRuntimeImmediateInputs immediateInputs;
  private final AgentRuntimeSettingRepository settings;
  private final UserRepository userRepository;
  private final AgentTemplateRegistry registry;
  private final AgentAccountFitPolicy accountFit;
  private final AssistantConfigRepository configRepo;
  private final ObjectMapper objectMapper;

  /**
   * 묶음·계정을 한 번씩 몰아 읽는다(AI 마다 조회하지 않게). 버전 자리는 {@link #versionId} 다. 같은 계정 행의 login_revision 도 함께 실어
   * runner desired 가 계정을 다시 읽지 않게 한다(WP-1450).
   */
  @Override
  public Map<Long, BoundRef> findBoundRefs(Collection<Long> agentUserIds) {
    Map<Long, Binding> bound = bindings.findBindings(agentUserIds);
    if (bound.isEmpty()) return Map.of();
    Map<Long, AgentAccountRow> rows =
        accounts.findActiveByIds(bound.values().stream().map(Binding::accountId).toList());
    Map<Long, BoundRef> out = new HashMap<>();
    bound.forEach(
        (agentId, binding) -> {
          AgentAccountRow row = rows.get(binding.accountId());
          if (row != null) {
            out.put(
                agentId,
                new BoundRef(
                    new ActiveCredentialRef(versionId(binding, row), row.provider()),
                    row.loginRevision()));
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
                                encryptionService.decrypt(row.encryptedSecret()),
                                // WP-1496: 계정의 워크스페이스 ID(선택 — 모델 조회가 쓴다)
                                row.workspaceId())));
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
   * Pod 용 묶인 로그인 — version 은 desired 의 loginVersion 과 같은 {@link #versionId}(이관 override 포함). 알던 번호와
   * 같으면 복호화 없이 payload 없는 결과, 아니면 원문을 싣는다 — 원문을 읽지 못하면 그 사유를 싣지 않고 empty(계정이 없는 것과 같이 404).
   */
  @Override
  public Optional<BoundLogin> findBoundLogin(long agentUserId, Long knownRevision) {
    return bindings
        .findBinding(agentUserId)
        .flatMap(
            binding ->
                accounts
                    .findActive(binding.accountId())
                    .filter(row -> AgentProviders.isLogin(row.provider()))
                    .flatMap(row -> toBoundLogin(agentUserId, binding, row, knownRevision)));
  }

  /** 읽은 묶음·계정 행으로 Pod 용 로그인을 만든다 — 알던 번호와 같으면 복호화하지 않는다. */
  private Optional<BoundLogin> toBoundLogin(
      long agentUserId, Binding binding, AgentAccountRow row, Long knownRevision) {
    if (knownRevision != null && knownRevision == row.loginRevision()) {
      return Optional.of(
          new BoundLogin(versionId(binding, row), row.loginRevision(), row.provider(), null));
    }
    try {
      return Optional.of(
          new BoundLogin(
              versionId(binding, row),
              row.loginRevision(),
              row.provider(),
              encryptionService.decrypt(row.encryptedSecret())));
    } catch (RuntimeException e) {
      // 암호문·예외 메시지는 싣지 않는다 — 값이 섞일 수 있다.
      log.warn(
          "묶인 로그인 원문을 읽지 못함: agentUserId={} accountId={} ({})",
          agentUserId,
          row.id(),
          e.getClass().getSimpleName());
      return Optional.empty();
    }
  }

  /**
   * Pod 가 올린 로그인을 저장한다. 계정 행을 잠가 읽고 같은 잠금 안에서 검사·저장하므로 서버 갱신·원문 교체와 겹쳐도 어긋나지 않는다 — 저장은 {@code
   * secret_version = 읽은 값}일 때만이라 사람이 그 사이 원문을 교체했으면(version 이 바뀜) 저장되지 않는다. 이유 코드만 돌려주고 올린 원문은 어디에도
   * 싣지 않는다.
   */
  @Override
  @Transactional
  public LoginUploadOutcome uploadBoundLogin(long agentUserId, long version, String payload) {
    Binding binding = bindings.findBinding(agentUserId).orElse(null);
    AgentAccountRow row =
        binding == null ? null : accounts.findActiveForUpdate(binding.accountId()).orElse(null);
    if (row == null) return LoginUploadOutcome.NOT_BOUND;
    if (!AgentProviders.CHATGPT.equals(row.provider())) return LoginUploadOutcome.NOT_CHATGPT;
    // 선택이 바뀐 직후의 Pod 는 낡은 로그인을 올릴 수 있다 — 지금 login 버전과 다르면 받지 않는다.
    if (versionId(binding, row) != version) return LoginUploadOutcome.VERSION_MISMATCH;
    String stored;
    try {
      stored = encryptionService.decrypt(row.encryptedSecret());
    } catch (RuntimeException e) {
      // 저장본을 못 읽는 계정 — GET 과 같이 「받을 로그인 없음」(404)으로 본다. 암호문·예외 메시지는 싣지 않는다.
      log.warn(
          "묶인 로그인 저장본을 읽지 못해 올리기를 받지 않음: agentUserId={} accountId={} ({})",
          agentUserId,
          row.id(),
          e.getClass().getSimpleName());
      return LoginUploadOutcome.NOT_BOUND;
    }
    String normalized;
    try {
      normalized = LoginInfoNormalizer.normalize(AgentProviders.CHATGPT, payload);
    } catch (InvalidProviderCredentialException | IllegalStateException e) {
      return LoginUploadOutcome.INVALID;
    }
    // 다른 ChatGPT 계정의 로그인을 올리면 이 계정을 덮어쓰게 된다 — account_id 가 같아야 한다. 어느 쪽이든 없으면 같은 계정임을 확인할 수 없어 받지
    // 않는다.
    String storedAccountId = LoginInfoNormalizer.chatgptAccountId(stored);
    String incomingAccountId = LoginInfoNormalizer.chatgptAccountId(normalized);
    if (storedAccountId == null || !storedAccountId.equals(incomingAccountId)) {
      return LoginUploadOutcome.ACCOUNT_MISMATCH;
    }
    // 갱신 토큰은 1회용이라 옛 로그인으로 덮으면 계정이 죽는다 — last_refresh 가 저장본보다 엄격히 새로울 때만.
    Instant incoming = AgentAccountService.lastRefreshOf(normalized);
    Instant current = AgentAccountService.lastRefreshOf(stored);
    if (current == null) current = row.lastRefreshedAt();
    if (incoming == null || (current != null && !incoming.isAfter(current))) {
      return LoginUploadOutcome.NOT_NEWER;
    }
    // Pod 가 직접 되가져온 로그인은 가장 새 것이다 — 이관 직후(NEEDS_CHECK)·갱신 토큰 무효(RELOGIN_REQUIRED) 표시를 푼다.
    boolean statusCleared = !AgentAccountService.STATUS_ACTIVE.equals(row.status());
    // 내용 저장·서버 갱신 준비(server_refresh_ready — 이제 서버가 이 계정의 갱신을 맡아도 된다)·정상 상태를 UPDATE 한 번으로.
    boolean saved =
        accounts.updateLoginContentConfirmed(
            row.id(),
            row.secretVersion(),
            encryptionService.encrypt(normalized),
            incoming.atOffset(ZoneOffset.UTC),
            AgentAccountService.STATUS_ACTIVE);
    if (!saved) return LoginUploadOutcome.VERSION_MISMATCH;
    // 감사 기록 — 계정 id·종류·라벨(공통 메타)에 더해 출처·변경 번호·AI·상태 변화만. 원문은 싣지 않는다.
    Map<String, String> extra = new HashMap<>();
    extra.put("source", "pod-upload");
    extra.put("revision", String.valueOf(row.loginRevision() + 1));
    extra.put("agent_user_id", String.valueOf(agentUserId));
    if (statusCleared) extra.put("status_from", row.status());
    accountService.audit(
        agentUserId,
        "AGENT_ACCOUNT_UPDATED",
        row.id(),
        "AI 계정 수정: " + row.label() + " (Pod 가 갱신한 로그인 반영" + (statusCleared ? ", 정상 확인" : "") + ")",
        row.provider(),
        row.label(),
        extra);
    return LoginUploadOutcome.SAVED;
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
      Long callerId,
      long agentUserId,
      String provider,
      String normalizedPlaintext,
      String label,
      String workspaceId) {
    // 실행 설정 행을 먼저 잠근다 — 아래 계정 찾기·만들기가 계정 행을 고칠(키 교체) 수 있어, 묶기({@link
    // AgentAccountBindingService})와 같은 「설정 행 → 계정 행」 순서를 지켜 동시 묶기와 교착하지 않게.
    Optional<AgentRuntimeSettingRepository.Row> setting = settings.findForUpdate(agentUserId);
    if (setting.isEmpty()) return;
    UserResponse agent = userRepository.findById(agentUserId).orElse(null);
    if (agent == null || AgentUsernames.isPersonalAssistant(agent.username())) return;
    // WP-1515: 기존 연결 등록은 바로 적용이다 — 아래에서 묶거나 풀지 않아도(같은 계정·템플릿 사라짐 등) runner 의 버전이 바뀔 수 있으니 먼저
    // 미뤄 둔 generation 을 NOW 로 돌린다. 설정 행은 위에서 잠갔고 계정 행은 아직이라 잠금 순서(설정 행 → 계정 행)도 지킨다. 알림은 아래 묶기·풀기가
    // 내지 않았을 때만 한 번 낸다({@link #notifyIfMarkedOnly}).
    boolean markedNow = markApplyNow(agentUserId);
    AgentTemplate template = registry.find(setting.get().templateName()).orElse(null);
    if (template == null || !AgentAccountFit.fits(template, provider)) {
      // 묶을 수 없는 상태 — 옛 묶음이 남으면 runner 가 방금 넣은 연결 대신 옛 계정을 계속 쓰므로 푼다. 비밀값은 로그에 싣지 않는다.
      boolean unbound = bindingService.unbindIfBound(callerId, agentUserId);
      notifyIfMarkedOnly(callerId, agentUserId, markedNow, unbound);
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
            accountFit.deliversToPod(agentUserId, provider),
            workspaceId);
    boolean bound = bindingService.bindWithoutResponse(callerId, agentUserId, accountId);
    notifyIfMarkedOnly(callerId, agentUserId, markedNow, bound);
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

  /**
   * 기존 연결 회수 다리(WP-1515) — 묶음을 풀기 전에 실행 설정 행을 잠그고 미뤄 둔 generation 을 NOW 로 돌린다. 연결 회수는 바로 적용이라, 묶이지
   * 않은 AI(풀 것이 없음)라도 runner 가 받는 claude 버전이 바뀌므로 미뤄 둔 generation 뒤에 묶여 기다리지 않게 한다. 실행 설정이 없으면(Pod
   * 아님) 묶음만 푼다.
   */
  @Override
  @Transactional
  public void unbindFromLegacy(Long callerId, long agentUserId) {
    // 잠금 순서: 설정 행 → 묶음. 풀기({@link AgentAccountBindingService#unbindIfBound})도
    // 같은 행을 다시 잠그지만 같은 트랜잭션이라 기다리지 않는다 — 잠근 행을 넘기는 별도 창구를 두기보다
    // 조회 한 번을 더 쓰는 쪽을 택했다.
    boolean markedNow =
        settings.findForUpdate(agentUserId).isPresent() && markApplyNow(agentUserId);
    boolean unbound = bindingService.unbindIfBound(callerId, agentUserId);
    notifyIfMarkedOnly(callerId, agentUserId, markedNow, unbound);
  }

  /**
   * 기존 연결 등록·회수 다리의 「바로 적용」 앞 절반(WP-1515) — 미뤄 둔 generation 을 NOW 로만 돌린다(알림은 내지 않는다). 호출자는 실행 설정 행을
   * 이미 잠근 뒤 부른다.
   *
   * @return 실제로 NOW 로 돌렸으면 true
   */
  private boolean markApplyNow(long agentUserId) {
    return immediateInputs.markApplyNow(List.of(agentUserId)) > 0;
  }

  /**
   * NOW 로 돌렸는데 뒤의 묶기·풀기가 runner 에 알리지 않았으면(같은 계정에 다시 묶기·묶이지 않아 풀 것 없음) 여기서 한 번 알린다(WP-1515) — 연결
   * 등록·회수는 원래 폴링에 맡기지만, 이미 미뤄 둔 generation 을 알고 있는 runner 가 NOW 를 폴링까지 기다리지 않게. 묶기·풀기가 이미 알렸으면 두 번
   * 알리지 않는다.
   */
  private void notifyIfMarkedOnly(
      Long callerId, long agentUserId, boolean markedNow, boolean alreadyNotified) {
    if (markedNow && !alreadyNotified) {
      immediateInputs.notifyChanged(List.of(agentUserId), callerId);
    }
  }
}
