# Gen:iA Works 커넥터 (genia-works-connector)

Claude 앱 · Cowork 에서 Gen:iA Works 를 연결하기 위한 커넥터 플러그인입니다.
별도 토큰 입력 없이 MCP 주소(`https://genia-works.iacloud.kr/mcp`)만 제공하고,
Claude 의 **표준 OAuth 흐름**으로 내 Gen:iA Works 계정에 연결합니다.

## 설치

Claude Code(2.1.275 이상) 에서 한 줄로 설치할 수 있습니다.

```
/plugin install genia-works-connector --marketplace bluleo78/smart-workplace
```

또는 수동으로:

1. Claude 앱 · Cowork 에서 마켓플레이스에 저장소 주소(`https://github.com/bluleo78/smart-workplace`)를 추가합니다.
2. 마켓플레이스의 **genia-works-connector** 플러그인을 설치합니다.
3. 최초 연결 시 동의 화면에서 승인하면 내 계정이 연결됩니다.

## 기존 genia-works 플러그인과의 차이

| | genia-works | genia-works-connector (이 플러그인) |
|---|---|---|
| 대상 | Claude Code (CLI) | Claude 앱 · Cowork |
| 인증 | 설정 › API 토큰 의 `swp_` 토큰을 `Authorization` 토큰 헤더로 전달 | 표준 OAuth (토큰 입력 없음) |
| MCP 주소 | 사용자 설정(기본 동일 주소) | 고정 `https://genia-works.iacloud.kr/mcp` |
| 부가 기능 | 스킬 · 훅 · 세션별 접속 신원 선택 등 | MCP 연결만 |

Claude Code 를 쓰신다면 기존 **genia-works** 플러그인을 그대로 사용하세요.

## 연결 끊기

Claude 앱 · Cowork 의 **설정 › API 토큰 › 연결된 앱** 에서
연결된 Gen:iA Works 앱을 끊을 수 있습니다.
