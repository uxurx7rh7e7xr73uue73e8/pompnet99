/**
 * Mail delivery. Real SMTP when SMTP_URL is configured; otherwise the API
 * returns the one-time link to the requesting user together with an explicit
 * "email delivery not configured" flag so nothing is silently dropped.
 */
export interface MailResult {
  delivered: boolean;
  reason?: string;
}

let nodemailer: any = null;

async function transport() {
  if (!process.env.SMTP_URL) return null;
  if (!nodemailer) {
    // Indirect specifier keeps the module optional: SMTP support is only needed
    // when SMTP_URL is configured, and the package is not a hard dependency.
    const specifier = 'nodemailer';
    nodemailer = await import(specifier).catch(() => null);
  }
  if (!nodemailer) return null;
  return nodemailer.createTransport(process.env.SMTP_URL);
}

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_URL);
}

export async function sendMail(to: string, subject: string, text: string): Promise<MailResult> {
  const tx = await transport();
  if (!tx) {
    return { delivered: false, reason: 'SMTP_URL is not configured on this deployment' };
  }
  try {
    await tx.sendMail({
      from: process.env.MAIL_FROM || 'no-reply@pompnet.cloud',
      to,
      subject,
      text,
    });
    return { delivered: true };
  } catch (err) {
    return { delivered: false, reason: (err as Error).message };
  }
}
