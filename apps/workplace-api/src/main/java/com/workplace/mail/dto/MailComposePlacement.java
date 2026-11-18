package com.workplace.mail.dto;

/**
 * 새 작성(새 메일·답장·전달·임시보관함 다시 열기)을 열 곳(WP-1744). DB {@code mail_user_setting.compose_mode} 의 CHECK 값과
 * 같은 이름이다. 모르는 값은 요청 본문을 읽는 단계에서 400 이 된다. JSON 필드 이름은 {@code composeMode} 그대로지만, 작성 종류(새·답장·전달 —
 * 웹의 ComposeMode)와 헷갈리지 않게 「배치」로 이름 짓는다.
 */
public enum MailComposePlacement {
  /** 읽기 창 — 메일 화면 오른쪽에서 바로 작성. */
  PANE,
  /** 우측 하단 — 작은 창으로 띄우고 목록을 계속 본다. 설정이 없을 때의 기본값. */
  DOCK,
  /** 새 창 — 브라우저 새 창으로 연다. */
  WINDOW
}
