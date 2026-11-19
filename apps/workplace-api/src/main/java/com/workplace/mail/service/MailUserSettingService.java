package com.workplace.mail.service;

import com.workplace.mail.dto.MailComposePlacement;
import com.workplace.mail.dto.MailUserSettingResponse;
import com.workplace.mail.dto.MailUserSettingUpdateRequest;
import com.workplace.mail.repository.MailUserSettingRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 내 메일 사용자 설정(WP-1744) 조회·저장. 지금은 새 작성을 열 곳(작성 방식) 하나이고, 메일 계정별이 아니라 사람마다 하나다. 서버에 두어 새로 고침·다른
 * 기기에서도 같게 연다.
 */
@Service
@RequiredArgsConstructor
public class MailUserSettingService {

  private final MailUserSettingRepository repository;

  /** 내 설정. 한 번도 고르지 않았으면 기본값(우측 하단 DOCK). */
  @Transactional(readOnly = true)
  public MailUserSettingResponse get(long userId) {
    return repository
        .findComposeMode(userId)
        .map(mode -> new MailUserSettingResponse(MailComposePlacement.valueOf(mode)))
        .orElseGet(MailUserSettingResponse::defaults);
  }

  /** 작성 방식을 저장하고 저장된 값을 돌려준다. 값 검사(null·모르는 값 400)는 컨트롤러의 요청 검증이 맡는다. */
  @Transactional
  public MailUserSettingResponse update(long userId, MailUserSettingUpdateRequest req) {
    repository.upsertComposeMode(userId, req.composeMode().name());
    return new MailUserSettingResponse(req.composeMode());
  }
}
