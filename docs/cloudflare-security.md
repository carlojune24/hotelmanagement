# Cloudflare security configuration

Zone **mmgroupcompanies.com** (Cloudflare **Free** plan). It fronts both apps on the same server:

| Site | Host | Behind |
|---|---|---|
| Hotel booking + management | `hotels.mmgroupcompanies.com` | tunnel → nginx → pm2 `mm-hotel` (:3011) |
| HR and payroll | `hr.mmgroupcompanies.com` | tunnel → nginx → pm2 `mm-hr` (:3010) |

Traffic goes browser → Cloudflare → `cloudflared` tunnel → nginx on the server, so the server never has to accept
connections from the internet (see `hr-server-deployment.md`, Step 8).

Everything below is set in the Cloudflare dashboard, not in this repo. It was configured by the owner on
2026-10-19; this page is the record of what is on, so it can be re-checked or rebuilt.

## Configured

### SSL/TLS

| Setting | Where | Value |
|---|---|---|
| Encryption mode | SSL/TLS → Overview | **Full (strict)** |
| Always Use HTTPS | SSL/TLS → Edge Certificates | On |
| Automatic HTTPS Rewrites | SSL/TLS → Edge Certificates | On |
| HSTS | SSL/TLS → Edge Certificates | On |
| Minimum TLS version | SSL/TLS → Edge Certificates | 1.2 |

The origin presents a Cloudflare *origin* certificate (`/etc/nginx/ssl/cloudflare-origin.pem`), which is what lets
Full (strict) work. If that certificate expires or is replaced, the sites show a 526 error until nginx has a valid one.

### DNS

- **DNSSEC** enabled (DNS → Settings). If the domain's registrar is ever changed, the DS record has to be moved
  or removed first, or the domain stops resolving.

### Security (new dashboard menu: Security → Security rules / Settings)

- **Managed rules** (the free Cloudflare WAF ruleset) turned on.
- **Bot Fight Mode** turned on.
- **Rate limiting rule "login rule"**: counts login form submissions per IP and blocks the IP when it goes over the
  limit. The rule expression is

  ```
  (http.request.method eq "POST" and http.request.uri.path contains "login")
  ```

  It covers the HR login (`/auth/login`), the HR emailed-code step (`/auth/login/verify`) and the hotel staff logins (`/…/management/login`). It counts form
  submissions only, not page views of the login screen. Counting characteristic: IP. Recommended values are 5
  requests per 10 seconds with the action **Block**; the free plan allows a single rate-limiting rule and fixes the
  period and block time, so the exact numbers are whatever the dashboard accepted. Check them in Security →
  Security rules → "login rule".

The apps also limit logins themselves (`rate-limit.ts` in each app). Cloudflare stops most guessing before it reaches
the server; the app limit is the second layer.

## Not done yet

In the order that matters most:

1. **Cloudflare Access in front of the HR site** (Zero Trust → Access → Applications, allow-listed emails with a
   one-time code or Google sign-in), and for the hotel's `/admin` and `/management`. Two paths must stay
   **bypassed** or things break: the PayMongo webhook (`/api/webhooks/paymongo`) and the machine API the hotel uses
   to read HR (`/api/v1/…`), which authenticates with its own key. Guest booking pages stay public.
2. **Lock the server to the tunnel.** Block inbound 80/443 from the internet (ufw), keep SSH reachable over
   Tailscale only. Every DNS record for the apps should be proxied (orange cloud).
3. **Real visitor IP.** The apps and nginx should read the client IP from `CF-Connecting-IP`; otherwise the app's own
   login limit sees one shared Cloudflare address for everyone. Not verified.
4. **Security headers** (CSP, X-Frame-Options, Referrer-Policy) from nginx or the apps. Not verified.
5. **Caching rules:** cache static assets only. Never cache `/management`, `/admin`, `/api`, uploads or anything
   behind a login.
6. **Turnstile** (Cloudflare's free CAPTCHA) on the login and guest forms. Needs a small code change.
7. **Account hygiene:** 2-step verification on the Cloudflare login, scoped API tokens (never the global key), and
   a second owner who can recover the account.

## If something stops working

- **You are blocked after failed logins:** wait for the block time (10 seconds on the free plan) and try again.
- **526 / "Invalid SSL certificate":** the origin certificate on the server is missing or expired (see above).
- **Online payments stop confirming:** check that nothing is blocking `/api/webhooks/paymongo` (a WAF, bot or
  Access rule) in Security → Security rules → Events.
- **To see what Cloudflare blocked:** Security → Overview and Analytics, or Security rules → Events.
