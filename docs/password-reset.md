# Password reset

Users reset a forgotten password themselves (tracker R42, Aaron step 16).
Supabase Auth sends the email and keeps the one-time link. The web adds no
table.

## How it works

1. **Forgot password** (`/forgot-password`, linked as "Forgot?" on sign-in):
   the user enters an email and the page calls
   `POST /api/v1/auth/forgot-password`. The answer is always
   `202 Accepted` with the same message, whether or not the address has an
   account. The backend asks Supabase Auth for the email after the response
   has gone out, so response timing does not reveal accounts either. The page
   shows "Check your email" and offers "Send another link" after 60 seconds.
2. **The email** links to Supabase's verify endpoint. Supabase starts a short
   recovery session and redirects to `<FRONTEND_URL>/reset-password`, with
   `#access_token=…&type=recovery` in the URL fragment. A stale or used link
   lands there with `#error=access_denied&error_code=otp_expired` instead.
3. **New password** (`/reset-password`): the page reads the fragment once and
   removes it from the address bar at once. It keeps the token in memory only.
   It posts the token and the new password to
   `POST /api/v1/auth/reset-password`, then opens
   `/login?reason=password-updated`, which says "Password updated. Sign in
   with your new password." An expired link, a missing token or a refused
   token shows "This link has expired or was already used", with the form for
   a new link.

The backend (`app/services/password_reset.py`):

- **Implicit flow.** The reset email is requested on a throwaway client set to
  the implicit flow, so the link carries the session itself. supabase-py
  defaults to PKCE, and a PKCE link returns a `?code=`. Only a code verifier
  kept by the requesting client can exchange that code, and a throwaway
  client is gone by the time the user clicks. (supabase_auth 2.31 sends no
  PKCE challenge from `reset_password_for_email` anyway; setting the flow
  keeps the links working if a later version starts to.)
- **Token check.** `get_user(token)` verifies the token with Supabase Auth.
  Only then is the JWT payload read. Its `amr` claim must show a session that
  opened an emailed link (`otp` in the implicit flow, `recovery` after a PKCE
  exchange) within the last hour. A password sign-in token is refused with
  400, as are expired or used tokens. When Supabase Auth cannot answer (a
  network error, a 5xx or an unreadable reply) the answer is 503 instead:
  the link may still be good, so the page keeps it and the user can try
  again without another email.
- **Setting the password.** The password follows sign-up's rule (at least 8
  characters) and is set with `auth.admin.update_user_by_id`. A password
  Supabase Auth refuses, under its password policy or for being over 72
  bytes, gets 422 and a message to choose another; only an outage is 503.
- **Ending sessions.** Supabase Auth's admin password update ends every
  session of the account. The backend then also calls
  `admin.sign_out(token, "global")` to make sure; that call usually finds
  the session gone and is refused with 401, 403 or 404, which counts as
  signed out (supabase-js does the same) and is logged at debug level only.
  Any other failure is a warning, and the reset still stands. The reset is
  written to the audit trail as `auth.password_reset`.
- **Limits.** Each worker process allows 5 requests an hour per email and 10
  per client address; beyond that the answer is 429 with `Retry-After`.
  Supabase's own email limits apply on top.
- **Logs.** Failures are logged with a keyed fingerprint of the address,
  never the address, token or password.

## Setup (Supabase dashboard and environment)

1. **Authentication → URL Configuration → Redirect URLs:** add
   `http://localhost:3000/reset-password` and the deployed web address, for
   example `https://<web-domain>/reset-password`. Supabase only redirects to
   listed URLs. For any other URL it falls back to the Site URL, and the user
   lands on the wrong page.
2. **Authentication → URL Configuration → Site URL:** this is only the
   fallback, because the backend always sends `redirect_to`. On the shared
   project the mobile and rental apps may rely on the current value: change
   it only with the DB owner. On a project of your own, set it to the
   deployed web address.
3. **Backend environment:** set `FRONTEND_URL` to the web address the emails
   should open (the default is `http://localhost:3000`). It must match a
   Redirect URL above, plus `/reset-password`.
4. **Authentication → Email Templates → Reset Password:** the default
   template works as it is. Keep `{{ .ConfirmationURL }}` as the link; it
   goes through Supabase's verify endpoint, which is what the implicit flow
   needs. Do not replace it with a `{{ .TokenHash }}` link for a server-side
   verify; this page does not handle those. The wording and branding may
   change.
5. **Email delivery and limits:** Supabase's built-in email service is for
   testing. It only delivers to addresses of the project's team members, and
   only a few emails an hour for the whole project. For real users, set up
   custom SMTP (Authentication → Emails → SMTP Settings), then raise the email
   rate limit under Authentication → Rate Limits. Supabase also sends one
   address at most one email a minute; the page's 60 second cooldown matches
   that. How long a link stays valid is the Email OTP Expiration setting of
   the email provider (default one hour).
6. **Behind a proxy:** the per-client limit counts the socket's address. When
   the backend runs behind a reverse proxy, start uvicorn with
   `--proxy-headers --forwarded-allow-ips=<proxy address>`. Otherwise every
   request counts as one client.

## Tests

- **Backend:** `backend/tests/test_password_reset.py`, under `strict_schema`,
  with every Supabase Auth call mocked. It covers the neutral 202 for known
  and unknown addresses and for provider errors, `redirect_to`, the implicit
  flow (including the real client's `/recover` request on a mock transport),
  the limits, the password rule, and invalid, expired, non-recovery and stale
  tokens. It also covers the success path.
- **Frontend:** `app/(auth)/forgot-password/page.test.tsx`,
  `app/(auth)/reset-password/page.test.tsx` and
  `app/(auth)/login/password-reset.test.tsx`.
