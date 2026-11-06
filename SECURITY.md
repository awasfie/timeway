# Security policy

This repository (`awasfie/timeway`) is maintained by AWstreams.

## Reporting a vulnerability

Please report suspected vulnerabilities privately:

- Email **info@awstreams.com** with the subject `SECURITY: timeway`, or
- open a private advisory under the repository's **Security** tab.

Do not open a public issue, and do not run automated scanners against our
production hosts without written permission. Include the affected URL or file,
steps to reproduce, and the impact you observed.

We acknowledge reports within 3 business days and aim to fix critical issues
within 7 days. We will tell you when the fix ships and credit you if you wish.

## Supported versions

Only the `main` branch and the version currently deployed to production receive
security fixes.

## Our baseline

- Dependabot alerts and update PRs (`.github/dependabot.yml`).
- CodeQL code scanning on every pull request, every push to `main` and weekly
  (`.github/workflows/codeql.yml`).
- Secrets live in a secret manager, never in this repository.
