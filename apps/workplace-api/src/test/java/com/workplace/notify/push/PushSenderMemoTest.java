package com.workplace.notify.push;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** PushSender — 한 번의 send 안에서 endpoint 검증은 origin 별, VAPID 서명은 origin(aud) 별 1회만 수행한다. */
class PushSenderMemoTest {

  final PushSubscriptionRepository subs = mock(PushSubscriptionRepository.class);
  final NotificationPreferenceService prefs = mock(NotificationPreferenceService.class);
  final WebPushEncryptor encryptor = mock(WebPushEncryptor.class);
  final VapidSigner signer = mock(VapidSigner.class);
  final EndpointValidator validator = mock(EndpointValidator.class);
  final PushGateway gateway = mock(PushGateway.class);
  final PushSender sender =
      new PushSender(
          new PushProperties(true, true, null, Duration.ofSeconds(1), null, null),
          subs,
          prefs,
          encryptor,
          signer,
          validator,
          gateway,
          new ObjectMapper());

  @Test
  void send_memoizesValidationAndSignaturePerOrigin() {
    String a1 = "https://fcm.example.com/send/1";
    String a2 = "https://fcm.example.com/send/2";
    String b1 = "https://push.other.example/send/3";
    when(prefs.filterEnabled(anyCollection(), any())).thenReturn(Set.of(7L));
    when(subs.findByUserIds(anyCollection()))
        .thenReturn(
            List.of(
                new PushSubscriptionRow(1, 7, a1, "AAAA", "AAAA"),
                new PushSubscriptionRow(2, 7, a2, "AAAA", "AAAA"),
                new PushSubscriptionRow(3, 7, b1, "AAAA", "AAAA")));
    when(validator.check(anyString())).thenReturn(EndpointValidator.Outcome.ALLOWED);
    when(signer.authorization(anyString())).thenReturn("vapid t=x, k=y");
    when(encryptor.encrypt(any(), any(), any())).thenReturn(new byte[] {1});
    when(gateway.deliver(anyString(), any(), anyMap())).thenReturn(201);

    sender.send(
        List.of(7L), new PushMessage(1L, PushCategory.DM, "t", "b", "/", "ch-1", "high", 60));

    // fcm.example.com 2건은 첫 구독에서만 검증·서명, other 는 따로 1회.
    verify(validator, times(1)).check(a1);
    verify(validator, times(0)).check(a2);
    verify(validator, times(1)).check(b1);
    verify(signer, times(2)).authorization(anyString());
    verify(gateway, times(3)).deliver(anyString(), any(), anyMap());
    verify(subs).markSuccess(eq(2L));
  }
}
