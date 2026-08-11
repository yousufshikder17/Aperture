# Authentication and security boundaries

## Authoritative identity

Every `/v1/*` route requires `Authorization: Bearer <token>`. The API verifies the credential, resolves the canonical database user, and attaches one `AuthenticatedUser` principal to the Hono context. Ownership, quotas, roles, and database queries use that principal's stable internal user ID.

Caller-supplied identity and privilege headers are unsupported. `x-user-email`, `x-user-id`, `x-role`, `x-tier`, and tenant/account variants cannot authenticate a request or alter its principal. Tests retain these names only to prove spoofing fails.

## Production OIDC/JWT configuration

```text
NODE_ENV=production
AUTH_MODE=oidc
AUTH_ISSUER=https://identity.example.com/
AUTH_AUDIENCE=https://api.example.com
AUTH_JWKS_URL=https://identity.example.com/.well-known/jwks.json
AUTH_ALLOWED_ALGORITHMS=RS256
AUTH_ADMIN_SUBJECTS=verified-operator-subject
```

The verifier checks signature, issuer, audience, time claims, subject, verified email, and the configured algorithm allowlist. The JWKS URL must use HTTPS in production. Missing or invalid configuration fails closed at the authentication boundary.

The production web app must acquire a token from the configured identity provider and send it as the bearer credential. A production build must never configure `NEXT_PUBLIC_AUTH_DEV_TOKEN`.

## Local development identities

Development mode uses explicit bearer tokens from local environment configuration:

```text
AUTH_MODE=development
AUTH_DEV_FREE_TOKEN=<at-least-32-random-characters>
AUTH_DEV_PREMIUM_TOKEN=<a-different-at-least-32-character-token>
AUTH_DEV_ADMIN_TOKEN=<another-different-at-least-32-character-token>
NEXT_PUBLIC_AUTH_DEV_TOKEN=<one-of-the-three-tokens>
```

| Identity | Stable subject | Tier | Role |
| --- | --- | --- | --- |
| `free_user` | `development:free_user` | `free` | `user` |
| `premium_user` | `development:premium_user` | `pro` | `user` |
| `admin_user` | `development:admin_user` | `free` | `admin` |

The distinction proves that authentication, product tier, and operational administration are independent. `AUTH_MODE=development` is rejected when `NODE_ENV=production`. Production never seeds these fixtures.

## Data and operational boundaries

- Owned records are scoped by the verified internal user UUID, not email or request input.
- Tier and organization metadata are loaded from server-side data.
- Admin status comes from the server-side `AUTH_ADMIN_SUBJECTS` allowlist or an isolated development fixture.
- Resume uploads default to 8 MiB (`MAX_RESUME_UPLOAD_BYTES`) and oversized input is rejected with `413` before extraction work.
- Match and resource-archive quotas are reserved for the verified user before the protected action.
- Shared listing scans and resource synchronization require the verified admin role.
- The current deployment supports one issuer; issuer-qualified subjects are required before enabling multiple identity providers with potentially overlapping subjects.
