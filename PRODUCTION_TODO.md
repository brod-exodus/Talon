# Production Follow-Ups

## Supabase Auth Email Delivery

### Goal
Enable reliable account confirmation and password-reset emails so Talon can stop relying on auto-confirmed users.

### Why this matters
- Current workflow depends on manual/auto-confirm in Supabase Auth.
- Recruiter/admin onboarding should be self-serve and auditable.
- Password recovery needs to work in production.

### Tasks
1. Configure an SMTP provider in Supabase Auth settings (`Resend`, `SendGrid`, `Postmark`, etc.).
2. Verify sender domain authentication (`SPF`, `DKIM`, and provider-required DNS records).
3. Set branded sender address and email templates for:
   - Account confirmation
   - Password reset
4. Disable auto-confirm for normal user onboarding after email delivery is verified.
5. Document the invite/login flow for operators.

### Acceptance checks
1. New user receives confirmation email and can confirm successfully.
2. Password reset email arrives and reset flow works end-to-end.
3. Login fails for unconfirmed users when auto-confirm is disabled.
4. `team_memberships`-based role access still works after confirmation.

### Runbook notes
- Keep one break-glass admin path available while rolling this out.
- Check spam folder and provider delivery logs during verification.
- Add monitoring/alerting for failed auth email delivery events.
