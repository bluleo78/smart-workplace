package com.workplace.auth.sso;

import java.net.URI;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** SSO 로그인 공개 엔드포인트(WP-48). 모두 GET — 브라우저 전체 이동으로 호출된다. */
@RestController
@RequestMapping("/api/v1/auth/sso")
@RequiredArgsConstructor
public class SsoAuthController {

  private final SsoProperties props;
  private final SsoLoginService loginService;

  /** 로그인 화면이 "Microsoft 계정으로 로그인" 버튼 노출 여부를 판단한다. */
  @GetMapping("/status")
  public Map<String, Boolean> status() {
    return Map.of("m365", props.isAvailable());
  }

  /** Microsoft 로그인 시작 — 302 + 트랜잭션 쿠키. */
  @GetMapping("/start")
  public ResponseEntity<Void> start(@RequestParam(required = false) String returnTo) {
    return redirect(loginService.start(returnTo));
  }

  /** Microsoft 복귀 — 결과는 항상 웹으로의 302. */
  @GetMapping("/callback")
  public ResponseEntity<Void> callback(
      @RequestParam(required = false) String code,
      @RequestParam(required = false) String state,
      @RequestParam(required = false) String error,
      @RequestParam(name = "error_description", required = false) String errorDescription,
      @RequestParam(name = "admin_consent", required = false) String adminConsent,
      @CookieValue(name = SsoTransactionCookie.NAME, required = false) String tx) {
    return redirect(
        loginService.callback(
            new SsoLoginService.CallbackParams(code, state, error, errorDescription, adminConsent), tx));
  }

  private static ResponseEntity<Void> redirect(SsoLoginService.Redirect r) {
    var builder = ResponseEntity.status(HttpStatus.FOUND).location(URI.create(r.location()));
    r.cookies().forEach(c -> builder.header(HttpHeaders.SET_COOKIE, c.toString()));
    return builder.build();
  }
}
