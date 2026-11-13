# Demo — Timeway: 5-minute click path

Tenant: "Demo — Timeway" (tw_organization 4eef2412-e500-4dd3-be1d-f95adca5523e, sandbox, team id 7, slug `demo-timeway`).
Host: Layla Haddad (Demo host), login `https://timeway.co/auth/login`; credentials stored by name `~/.hermes/secrets/timeway_demo_host_login.json` (never in docs or cards).
Sample data: 3 event types (Showroom visit EN, زيارة صالة العرض AR, Consultation call), Sun–Thu 09:00–17:00 Asia/Dubai, 6 Gulf sample bookings (example.com addresses, +971/+966/+974 placeholder numbers). No real customer data.
Webhook: team 7 → `https://api.spenai.net/webhooks/timeway` (BOOKING_CREATED / RESCHEDULED / CANCELLED), signed with the shared TIMEWAY_WEBHOOK_SECRET.

| # | URL | Presenter says | Expected screen |
|---|-----|----------------|-----------------|
| 1 | https://timeway.co/team/awstreams/demo | "This is a live public booking page — no login for the visitor." | AWstreams demo event, calendar with open days (read-only; we do not book here). |
| 2 | https://timeway.co/team/demo-timeway/showroom-visit | "Here is a showroom's page: Gulf week, Dubai time, location shown up front." | "Demo — Timeway / Showroom visit / 30m / Demo Showroom, Dubai Internet City", Sun–Thu open, Fri/Sat greyed, Hijri toggle. |
| 3 | same page → pick a day → pick a time | "The visitor picks a slot in their own time zone." | Slot list 9:00am… for the day; booking form opens. |
| 4 | booking form | "We ask only what sales needs: name, email, phone/WhatsApp, company." | Fields: Name, Email, Phone / WhatsApp · رقم الهاتف / واتساب, Company · الشركة, Notes · ملاحظات. Click Confirm. |
| 5 | https://timeway.co/booking/&lt;uid&gt; | "Booked. The visitor gets the email invite immediately." | "This meeting is scheduled", What/When/Where, Reschedule link. Email "Showroom visit between Layla Haddad (Demo host) and …" from bookings@notify.timeway.co lands in Inbox. |
| 6 | Reschedule link → https://timeway.co/team/demo-timeway/showroom-visit?rescheduleUid=&lt;uid&gt; | "Plans change — the visitor moves it themselves." | Same calendar with "Original booking" shown; pick new slot, add reason, click Reschedule. |
| 7 | https://timeway.co/booking/&lt;new uid&gt; | "New time confirmed; old link now says rescheduled." | "This meeting is scheduled", Reschedule reason, Original booking struck through; second email "…has been rescheduled to …". |
| 8 | SalesOS side (no screen) | "Every booking change is pushed to SalesOS, signed." | SalesOS logs accept the signed delivery (202 `unmatched` for bookings SalesOS did not create itself). |
| 9 | https://timeway.co/auth/login → /bookings/upcoming | "The host sees their day." | KNOWN ISSUE: list currently empty for every user (bookings/get runs without org context under RLS) — child card filed; skip this step until fixed. |

AR: use https://timeway.co/team/demo-timeway/showroom-visit-ar for the Arabic event (title and description in Arabic, form labels bilingual).
