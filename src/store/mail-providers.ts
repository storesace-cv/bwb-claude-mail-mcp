export type MailProvider = "generic" | "microsoft" | "google" | "icloud";
export type MailAuthType = "password" | "oauth2";

export interface MailProviderPreset {
  provider: MailProvider;
  label: string;
  authType: MailAuthType;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  /** true = implicit TLS (465); false with tls = STARTTLS (587) */
  smtpImplicitTls: boolean;
  helpHtml: string;
}

export const MAIL_PROVIDERS: Record<MailProvider, MailProviderPreset> = {
  generic: {
    provider: "generic",
    label: "Servidor normal (IMAP/SMTP)",
    authType: "password",
    imapHost: "mail.bwb.pt",
    imapPort: 993,
    smtpHost: "mail.bwb.pt",
    smtpPort: 465,
    smtpImplicitTls: true,
    helpHtml: "Credenciais habituais do teu servidor de correio.",
  },
  microsoft: {
    provider: "microsoft",
    label: "Outlook.com / Hotmail (pessoal)",
    authType: "password",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    smtpHost: "smtp-mail.outlook.com",
    smtpPort: 587,
    smtpImplicitTls: false,
    helpHtml:
      "Cria uma <a href=\"https://account.live.com/proofs/AppPassword\" target=\"_blank\" rel=\"noopener\">senha de aplicação</a> na conta Microsoft (com verificação em 2 passos) e cola-a nos campos Password IMAP/SMTP. User = o teu email completo (ex.: nome@outlook.com).",
  },
  google: {
    provider: "google",
    label: "Gmail (pessoal)",
    authType: "password",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
    smtpImplicitTls: false,
    helpHtml:
      "Com a verificação em 2 passos activa, cria uma <a href=\"https://myaccount.google.com/apppasswords\" target=\"_blank\" rel=\"noopener\">senha de aplicação</a> Google e cola-a aqui (não a password normal do Gmail). User = o teu @gmail.com.",
  },
  icloud: {
    provider: "icloud",
    label: "iCloud Mail (Apple)",
    authType: "password",
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    smtpImplicitTls: false,
    helpHtml:
      "Cria uma <a href=\"https://support.apple.com/pt-pt/102654\" target=\"_blank\" rel=\"noopener\">senha de aplicação</a> em appleid.apple.com e usa-a aqui (não a password da Apple ID).",
  },
};

export function parseMailProvider(raw: unknown): MailProvider {
  const s = String(raw ?? "generic").toLowerCase();
  if (s === "microsoft" || s === "google" || s === "icloud" || s === "generic") return s;
  return "generic";
}

export function applyProviderPreset(
  provider: MailProvider,
  overrides?: Partial<{
    imap_host: string;
    imap_port: string | number;
    smtp_host: string;
    smtp_port: string | number;
  }>
): {
  imap_host: string;
  imap_port: string;
  smtp_host: string;
  smtp_port: string;
  smtp_tls: string;
} {
  const p = MAIL_PROVIDERS[provider];
  return {
    imap_host: String(overrides?.imap_host ?? p.imapHost),
    imap_port: String(overrides?.imap_port ?? p.imapPort),
    smtp_host: String(overrides?.smtp_host ?? p.smtpHost),
    smtp_port: String(overrides?.smtp_port ?? p.smtpPort),
    smtp_tls: "true",
  };
}
