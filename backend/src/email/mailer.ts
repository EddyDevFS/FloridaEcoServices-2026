import nodemailer from 'nodemailer';

export type MailEnv = {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
};

export function readMailEnv(): MailEnv | null {
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 0);
  const from = String(process.env.SMTP_FROM || '').trim();
  if (!host || !port || !from) return null;
  const user = String(process.env.SMTP_USER || '').trim() || undefined;
  const pass = String(process.env.SMTP_PASS || '').trim() || undefined;
  return { host, port, user, pass, from };
}

export async function sendMail(opts: {
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
}) {
  const env = readMailEnv();
  if (!env) throw new Error('smtp_not_configured');

  const transporter = nodemailer.createTransport({
    host: env.host,
    port: env.port,
    secure: env.port === 465,
    auth: env.user && env.pass ? { user: env.user, pass: env.pass } : undefined
  });

  return transporter.sendMail({
    from: env.from,
    to: (opts.to || []).filter(Boolean).join(','),
    cc: (opts.cc || []).filter(Boolean).join(',') || undefined,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    attachments: (opts.attachments || []).map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType
    }))
  });
}
