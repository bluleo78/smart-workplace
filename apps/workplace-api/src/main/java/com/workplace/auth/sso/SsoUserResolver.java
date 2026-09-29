package com.workplace.auth.sso;

import com.workplace.auth.repository.UserExternalIdentityRepository;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 검증된 id_token 클레임으로 로그인할 사용자를 결정한다(WP-48).
 *
 * <p>순서가 규칙이다: (1) (tid, oid) 연결 → (2) 없으면 도메인이 검증된 값(xms_edov=true 인 email, #EXT# 없는 upn)을
 * username 과만 대소문자 무시로 매칭 → (3) 진입 검사(HUMAN·활성·SSO 켜진 워크스페이스 소속) → (4) 최초 연결 저장. 진입 검사를 연결 저장보다 먼저
 * 해 거부된 로그인은 연결을 남기지 않는다. 자동 계정 생성(JIT)은 하지 않는다. email 클레임은 임의 Entra 테넌트가 위조할 수 있어(nOAuth) xms_edov
 * 없이는 믿지 않는다.
 */
@Component
@RequiredArgsConstructor
public class SsoUserResolver {

  static final String PROVIDER = "M365";

  private final UserExternalIdentityRepository identityRepository;
  private final UserRepository userRepository;
  private final MembershipRepository membershipRepository;

  /** 결정 결과 — newlyLinked 면 감사 USER_SSO_LINK 를 남긴다. */
  public record Resolution(UserResponse user, boolean newlyLinked, String tid, String oid) {}

  @Transactional
  public Resolution resolve(Jwt idToken) {
    String tid = idToken.getClaimAsString("tid");
    String oid = idToken.getClaimAsString("oid");
    if (tid == null || oid == null) throw denied("no_subject");

    Optional<Long> linked = identityRepository.findUserId(PROVIDER, tid, oid);
    if (linked.isPresent()) {
      UserResponse user = load(linked.get());
      checkEntry(user);
      return new Resolution(user, false, tid, oid);
    }

    UserResponse user = load(matchCandidate(idToken));
    if (identityRepository.existsForUser(user.id(), PROVIDER)) throw denied("conflict");
    checkEntry(user);

    if (!identityRepository.insert(user.id(), PROVIDER, tid, oid)) {
      // 동시 최초 로그인 — 같은 (tid,oid) 가 같은 사용자로 먼저 연결됐으면 성공, 아니면 충돌.
      Long winner = identityRepository.findUserId(PROVIDER, tid, oid).orElse(null);
      if (!user.id().equals(winner)) throw denied("conflict");
      return new Resolution(user, false, tid, oid);
    }
    return new Resolution(user, true, tid, oid);
  }

  /** 도메인 검증된 후보값으로 username 매칭. 후보들이 한 사용자로 모여야 한다. */
  private long matchCandidate(Jwt idToken) {
    Set<String> candidates = new LinkedHashSet<>();
    if (Boolean.TRUE.equals(idToken.getClaimAsBoolean("xms_edov"))) {
      addNormalized(candidates, idToken.getClaimAsString("email"));
    }
    String upn = idToken.getClaimAsString("upn");
    if (upn != null && !upn.contains("#EXT#")) addNormalized(candidates, upn);
    if (candidates.isEmpty()) throw denied("unverified");

    Long matched = null;
    for (String candidate : candidates) {
      List<Long> ids = userRepository.findIdsByUsernameIgnoreCase(candidate);
      if (ids.size() > 1) throw denied("conflict");
      if (ids.isEmpty()) continue;
      if (matched != null && !matched.equals(ids.get(0))) throw denied("conflict");
      matched = ids.get(0);
    }
    if (matched == null) throw denied("not_registered");
    return matched;
  }

  /** 진입 검사 — 비밀번호 로그인과 같은 기준 + SSO 켜진 워크스페이스 소속. */
  private void checkEntry(UserResponse user) {
    if (UserKind.isAgent(user.kind())) throw denied("agent");
    if (!user.isActive()) throw denied("inactive");
    if (membershipRepository.findActiveSsoEnabledByUser(user.id()).isEmpty()) {
      throw denied("no_workspace");
    }
  }

  private UserResponse load(long userId) {
    return userRepository.findById(userId).orElseThrow(() -> denied("not_registered"));
  }

  private static void addNormalized(Set<String> out, String value) {
    if (value != null && !value.isBlank()) out.add(value.trim().toLowerCase(Locale.ROOT));
  }

  private static SsoLoginException denied(String reason) {
    return new SsoLoginException(SsoLoginException.DENIED, reason);
  }
}
