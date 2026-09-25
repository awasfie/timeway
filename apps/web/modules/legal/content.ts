/**
 * CM-T6 — Timeway legal pages (Bible v12.1 PART CM, UX.3.13; Q2-A "legal first").
 * Replaces the upstream cal.com/terms and cal.com/privacy links.
 *
 * Entity: AWSTREAMS DMCC for every product until Ahmed says otherwise (Bible item 8, D-R54-1),
 * with the Stripe account's details: Stripe Tax head-office address (line1 "1308 …, 13th floor, Tiffany Tower,
 * Cluster W", city Dubai, AE) and the UAE VAT TRN on the account.
 * Refund rule: CM.0-7 verbatim, and the UX.3.x FAQ answer.
 * Copy style (UX voice): plain sentences, no hype, no "Oops".
 *
 * Changing any fact here (entity, address, TRN, processors, refund rule) is a Bible-level
 * change: update PART CM / the ops-log in the same PR.
 */

export const LEGAL_ENTITY = {
  name: "AWSTREAMS DMCC",
  address: "Office 1308, 13th floor, Tiffany Tower, Cluster W, Dubai, United Arab Emirates",
  trn: "100460677600003",
  country: "United Arab Emirates",
} as const;

export const LEGAL_LAST_UPDATED = "25 September 2026";

export type LegalSection = { id: string; heading: string; paragraphs: string[]; bullets?: string[] };
export type LegalDocumentContent = { title: string; intro: string; sections: LegalSection[] };

export function termsContent(
  appName: string,
  supportEmail: string,
  websiteUrl: string
): LegalDocumentContent {
  return {
    title: "Terms of Service",
    intro: `These terms are an agreement between you and ${LEGAL_ENTITY.name} ("we", "us"), the company that operates ${appName} at ${websiteUrl}. By creating an account or booking through ${appName}, you agree to them. If you use ${appName} for an organization, you confirm you may accept these terms on its behalf.`,
    sections: [
      {
        id: "service",
        heading: "1. The service",
        paragraphs: [
          `${appName} is a scheduling service: you publish your availability, other people book time with you, and ${appName} sends confirmations, reminders, calendar invitations and video-meeting links.`,
          "We may change or improve features. If a change removes something you pay for, we will tell you at least 30 days before it takes effect.",
        ],
      },
      {
        id: "accounts",
        heading: "2. Your account",
        paragraphs: [
          "You must be at least 18 years old and give accurate information when you sign up.",
          "Keep your password and any API keys secret. You are responsible for activity under your account. Tell us at once if you think your account has been misused.",
        ],
      },
      {
        id: "acceptable-use",
        heading: "3. Acceptable use",
        paragraphs: ["You agree not to use the service to:"],
        bullets: [
          "send spam or messages people have not asked for, or harvest other people's contact details;",
          "break any law, or infringe anyone's privacy, intellectual property or other rights;",
          "upload malware, probe or overload our systems, or get around usage limits or security controls;",
          "impersonate anyone, or mislead the people who book with you.",
        ],
      },
      {
        id: "your-content",
        heading: "4. Your content and your invitees",
        paragraphs: [
          `You keep all rights to the content you put into ${appName} (event details, availability, booking questions and answers). You give us permission to store and process it only to run the service for you.`,
          `When someone books with you, you decide what you ask them and what you do with their answers. You are responsible for having a lawful basis to collect that information. We process it on your behalf, as described in our Privacy Policy.`,
        ],
      },
      {
        id: "plans-billing",
        heading: "5. Plans, trials and billing",
        paragraphs: [
          "Prices are in US dollars. VAT is included where applicable: a customer in the United Arab Emirates pays the list price with 5% VAT inside it, and a customer elsewhere pays the list price with no VAT line.",
          "Paid plans renew automatically, monthly or yearly, until you cancel. Payments are processed by Stripe; we never see or store your full card number.",
          "Our lowest paid plan comes with a 14-day free trial. We ask for a card when the trial starts and charge it at the end of day 14 unless you cancel first. We email you before that charge with the amount and the date.",
          "Upgrades take effect straight away and you pay the prorated difference that day. Downgrades take effect at the end of your current billing period.",
          "If a payment fails we retry it and email you. If it still fails, your account becomes read-only until the payment goes through.",
        ],
      },
      {
        id: "cancellation-refunds",
        heading: "6. Cancellation and refunds",
        paragraphs: [
          "You can cancel at any time from your billing page, with no call or email needed. You keep access until the end of the period you have paid for.",
          "Monthly plans aren't refunded; yearly plans are refunded pro-rata within 30 days of the first purchase.",
          `To ask for a yearly refund, or to dispute a charge, write to ${supportEmail}.`,
        ],
      },
      {
        id: "third-party",
        heading: "7. Connected services",
        paragraphs: [
          `If you connect a calendar, video or other third-party service, ${appName} uses it only with the access you grant, and that service's own terms also apply. You can disconnect it at any time from your settings.`,
        ],
      },
      {
        id: "availability",
        heading: "8. Availability and changes",
        paragraphs: [
          "We work to keep the service running and your data safe, but we can't promise it will never be interrupted. We may suspend an account that breaks these terms or puts the service or other users at risk; where we can, we will tell you first and give you a chance to fix the problem.",
        ],
      },
      {
        id: "liability",
        heading: "9. Liability",
        paragraphs: [
          'The service is provided "as is". To the extent the law allows, we are not liable for indirect or consequential losses, such as lost profits or missed meetings, and our total liability for any claim is limited to the amount you paid us in the 12 months before the claim.',
          "Nothing in these terms limits liability that cannot be limited by law.",
        ],
      },
      {
        id: "ending",
        heading: "10. Closing your account",
        paragraphs: [
          "You can close your account at any time. If your subscription ends, your data is kept for 90 days so you can come back, and then deleted, after we have emailed you notice.",
        ],
      },
      {
        id: "law",
        heading: "11. Governing law",
        paragraphs: [
          "These terms are governed by the laws of the Emirate of Dubai and the federal laws of the United Arab Emirates. The courts of Dubai have jurisdiction over any dispute, unless the law of the country you live in gives you the right to bring a claim there.",
        ],
      },
      {
        id: "changes",
        heading: "12. Changes to these terms",
        paragraphs: [
          "If we make a material change, we will email account owners at least 30 days before it takes effect. The date at the top of this page shows when these terms last changed.",
        ],
      },
      {
        id: "contact",
        heading: "13. Contact",
        paragraphs: [
          `${LEGAL_ENTITY.name}, ${LEGAL_ENTITY.address}. UAE VAT TRN ${LEGAL_ENTITY.trn}. Email: ${supportEmail}.`,
        ],
      },
    ],
  };
}

export function privacyContent(appName: string, supportEmail: string): LegalDocumentContent {
  return {
    title: "Privacy Policy",
    intro: `This policy explains what personal data ${appName} collects, why, who we share it with and the choices you have. ${appName} is operated by ${LEGAL_ENTITY.name} (${LEGAL_ENTITY.country}).`,
    sections: [
      {
        id: "roles",
        heading: "1. Who is responsible",
        paragraphs: [
          `For your own account data, ${LEGAL_ENTITY.name} is the controller.`,
          `When someone books a meeting with a ${appName} user, that user decides what information to collect from the person booking. For that booking data, the user is the controller and we act as their processor. Questions about a booking are best sent to the person you booked with; we will help them answer.`,
        ],
      },
      {
        id: "collect",
        heading: "2. What we collect",
        paragraphs: [],
        bullets: [
          "Account data: name, email address, password (stored hashed), time zone, language and profile details you add.",
          "Scheduling data: event types, availability, bookings, and the answers people give when they book.",
          "Connected-calendar data: if you connect a calendar, we read free/busy times to avoid double-booking and write the events you book. We don't use calendar content for anything else.",
          "Billing data: plan, billing address and tax ID if you give one. Card details go straight to Stripe.",
          "Technical data: IP address, device and browser type, and logs of requests and errors, which we use to secure and fix the service.",
          "Messages you send us, such as support emails.",
        ],
      },
      {
        id: "use",
        heading: "3. Why we use it",
        paragraphs: [],
        bullets: [
          "To provide the service: create bookings, send confirmations, reminders and calendar invitations, and create meeting links (performance of our contract with you).",
          "To bill you and meet our tax and accounting duties (contract and legal obligation).",
          "To keep the service secure, prevent abuse and fix errors (our legitimate interest in running a safe service).",
          "To tell you about important changes to the service or these policies (contract and legitimate interest).",
        ],
      },
      {
        id: "no-sale",
        heading: "4. What we don't do",
        paragraphs: [
          "We don't sell personal data, we don't use it for advertising, and we don't use your booking data to train AI models.",
        ],
      },
      {
        id: "processors",
        heading: "5. Who we share it with",
        paragraphs: [
          "We use a small number of service providers, each bound by contract to use the data only to provide their service to us:",
        ],
        bullets: [
          "Contabo GmbH: servers that host the application and its database (European Union).",
          "Cloudflare, Inc.: network, DNS and security services in front of the application.",
          "Twilio SendGrid: delivery of booking emails.",
          "Stripe, Inc.: payments and invoicing.",
          "Functional Software, Inc. (Sentry): error monitoring.",
          "Google LLC: only if you choose to sign in with Google or connect a Google calendar.",
        ],
      },
      {
        id: "transfers",
        heading: "6. International transfers",
        paragraphs: [
          `Your data is hosted in the European Union and may be processed in other countries where our providers operate, including the United States. Where the law requires it, we rely on safeguards such as the European Commission's standard contractual clauses. This includes transfers under the UAE Personal Data Protection Law.`,
        ],
      },
      {
        id: "retention",
        heading: "7. How long we keep it",
        paragraphs: [
          "We keep account and scheduling data while your account is active. If your subscription ends, we keep it for 90 days so you can come back, then delete it after emailing you notice. You can ask us to delete your account sooner at any time.",
          "We keep invoices and payment records for as long as tax law requires. Server logs are kept for a short period for security.",
        ],
      },
      {
        id: "rights",
        heading: "8. Your rights",
        paragraphs: [
          `Depending on where you live, you can ask to access, correct, delete or export your data, to restrict or object to how we use it, and to withdraw consent you have given. Write to ${supportEmail}; we reply within 30 days. You can also complain to your local data-protection authority.`,
        ],
      },
      {
        id: "security",
        heading: "9. Security",
        paragraphs: [
          "Data travels over encrypted connections, passwords are hashed, and access to production systems is limited to the people who need it. No system is perfectly secure; if a breach affects your data, we will tell you without undue delay.",
        ],
      },
      {
        id: "cookies",
        heading: "10. Cookies",
        paragraphs: [
          `${appName} uses cookies that are needed to sign you in, keep your session secure and remember your settings. We don't use advertising cookies.`,
        ],
      },
      {
        id: "children",
        heading: "11. Children",
        paragraphs: [
          `${appName} is not meant for children under 18, and we don't knowingly collect their data.`,
        ],
      },
      {
        id: "changes",
        heading: "12. Changes",
        paragraphs: [
          "If we make a material change, we will email account owners before it takes effect. The date at the top of this page shows when this policy last changed.",
        ],
      },
      {
        id: "contact",
        heading: "13. Contact",
        paragraphs: [`${LEGAL_ENTITY.name}, ${LEGAL_ENTITY.address}. Email: ${supportEmail}.`],
      },
    ],
  };
}
