// 보호 리소스 메타데이터(RFC 9728, WP-1685) — Claude 앱 커넥터 같은 MCP 클라이언트가 OAuth 로그인을 시작하는 입구.
// 클라이언트는 401 의 `WWW-Authenticate: Bearer resource_metadata="…"` 를 따라 이 문서를 읽고, 여기 적힌 인가 서버(workplace-api)
// 메타데이터로 넘어가 PKCE 로그인을 한다. 이 앱은 문서만 내준다 — 토큰 발급·검증은 여전히 workplace-api 가 한다(무비밀 원칙 그대로).
import { Router, type Request } from 'express';

import { InvalidScopeError, MCP_ROUTES, resolveScope } from '../mcp/scope.js';

/** 보호 리소스 메타데이터 경로 접두어 — 뒤에 MCP 경로(`/mcp`, `/mcp/readonly`, `/mcp/x/<앱>`…)가 붙는다(RFC 9728 §3.1). */
export const PROTECTED_RESOURCE_METADATA_PREFIX = '/.well-known/oauth-protected-resource';

/**
 * 공개 원점에 쓸 수 있는 호스트 — 영문·숫자·점·하이픈·콜론(포트)·대괄호(IPv6)만(리뷰 D7.1). 호스트는 요청 헤더(Host·X-Forwarded-Host)에서
 * 오므로 따옴표·공백·역슬래시 같은 글자가 섞이면 401 의 `WWW-Authenticate` quoted-string 을 깨거나 문서의 resource 를 엉뚱한 값으로 만든다.
 */
const VALID_HOST = /^[A-Za-z0-9.\-:[\]]+$/;

/** MCP 경로로 그대로 이어 붙여도 되는 글자(RFC 3986 경로 글자) — 따옴표·역슬래시가 든 경로는 안내 URL 에 싣지 않는다. */
const SAFE_PATH = /^[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/;

/**
 * 사용자가 입력한 주소의 원점(scheme://host[:port]). 앞단 nginx 가 넘긴 X-Forwarded-Proto/X-Forwarded-Host 를 쓴다
 * (createApp 이 `trust proxy` 를 true 로 켜므로 forwarded 헤더는 늘 믿는다). webHost·mcpHost 어느 쪽으로 들어와도 그 주소와 같아야
 * 클라이언트가 resource 를 받아들인다. Express 4 의 `req.hostname` 은 포트를 떼고 `req.get('host')` 는 forwarded 를 보지 않아,
 * hostname 과 같은 규칙(X-Forwarded-Host 의 첫 값)으로 포트까지 살려 직접 고른다.
 *
 * 호스트가 비었거나 허용 글자 밖이거나 scheme 이 http·https 가 아니면 null — 부르는 쪽이 대신할 값을 고른다(리뷰 D7.1).
 */
export function publicOrigin(req: Request): string | null {
  const forwarded = req.get('x-forwarded-host');
  const host = forwarded ? forwarded.split(',')[0].trim() : req.get('host');
  const proto = req.protocol;
  if (!host || !VALID_HOST.test(host) || (proto !== 'http' && proto !== 'https')) return null;
  return `${proto}://${host}`;
}

/**
 * 그 MCP 경로의 보호 리소스 메타데이터 URL — 401 의 resource_metadata 값이다. 요청의 공개 원점이 올바르지 않으면 WORKPLACE_OAUTH_ISSUER 의
 * 원점으로 대신하고, 그것도 없거나 경로에 쓸 수 없는 글자가 있으면 null(부르는 쪽은 resource_metadata 없이 `Bearer` 만 보낸다).
 */
export function protectedResourceMetadataUrl(req: Request, mcpPath: string): string | null {
  if (!SAFE_PATH.test(mcpPath)) return null;
  const origin = publicOrigin(req) ?? configuredIssuerOrigin();
  return origin ? `${origin}${PROTECTED_RESOURCE_METADATA_PREFIX}${mcpPath}` : null;
}

/**
 * 인가 서버 주소 — 환경 변수 WORKPLACE_OAUTH_ISSUER(helm: config.webBaseUrl, 끝 `/` 제거), 없거나 비었으면 undefined(로컬 — 부르는 쪽이
 * 요청의 공개 원점을 쓴다). 인가 서버(api)의 issuer 와 글자까지 같아야 클라이언트가 메타데이터의 issuer 검증(RFC 8414 §3.3)을 통과한다.
 * 요청마다 읽는다 — 값이 바뀔 일은 없지만 테스트가 환경 변수를 바꿔 끼울 수 있게.
 */
function configuredIssuer(): string | undefined {
  return process.env.WORKPLACE_OAUTH_ISSUER?.trim().replace(/\/+$/, '') || undefined;
}

/** WORKPLACE_OAUTH_ISSUER 의 원점(scheme://host[:port]) — 없거나 URL 이 아니면 null. */
function configuredIssuerOrigin(): string | null {
  const configured = configuredIssuer();
  if (!configured) return null;
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

/**
 * 보호 리소스 메타데이터 라우터 — MCP 연결 경로 네 가지(WP-350)마다 그 경로를 resource 로 하는 문서를 낸다.
 * resource 는 요청 경로를 디코딩하지 않은 그대로 붙여 사용자가 입력한 MCP 주소와 같게 한다.
 * 앱 선택 경로의 앱 이름은 POST 와 같은 규칙(resolveScope)으로 검증하고, 틀리면 그런 리소스가 없으므로 404.
 * 공개 원점의 호스트가 올바르지 않으면 resource 를 만들 수 없으므로 400(리뷰 D7.1).
 */
export const oauthMetadataRouter = Router();
for (const { path: mcpRoute } of MCP_ROUTES) {
  oauthMetadataRouter.get<string, { apps?: string }>(PROTECTED_RESOURCE_METADATA_PREFIX + mcpRoute, (req, res) => {
    if (req.params.apps !== undefined) {
      try {
        resolveScope({ pathApps: req.params.apps, readOnly: false }, undefined);
      } catch (e) {
        if (!(e instanceof InvalidScopeError)) throw e;
        res.status(404).json({ error: 'not_found', error_description: e.message });
        return;
      }
    }
    const origin = publicOrigin(req);
    if (!origin) {
      res.status(400).json({ error: 'invalid_request', error_description: '요청 호스트가 올바르지 않습니다.' });
      return;
    }
    const mcpPath = req.path.slice(PROTECTED_RESOURCE_METADATA_PREFIX.length);
    res.json({
      resource: origin + mcpPath,
      // 인가 서버 — WORKPLACE_OAUTH_ISSUER, 없으면(로컬) 요청의 공개 원점.
      authorization_servers: [configuredIssuer() ?? origin],
      bearer_methods_supported: ['header'],
    });
  });
}
