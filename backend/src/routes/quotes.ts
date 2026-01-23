import { Router, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireRole } from '../auth/roles';
import { renderQuotePdf } from '../pdf/quotePdf';
import { sendMail } from '../email/mailer';

const router = Router();

function createPublicToken() {
  return randomBytes(18).toString('hex');
}

function appBaseUrl() {
  const appUrl = String(process.env.PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  if (appUrl) return appUrl;
  return 'http://localhost:8000';
}

function quoteSignLink(token: string) {
  return `${appBaseUrl()}/quote_sign.html?token=${encodeURIComponent(token)}`;
}

function brandEmail() {
  return String(process.env.QUOTE_NOTIFY_EMAIL || process.env.SMTP_FROM || 'eddy@floridaecoservices.com').trim();
}

function planLabel(planKey: string) {
  const key = String(planKey || '').trim();
  if (key === 'ondemand') return 'On‑Demand';
  if (key === 'partner') return 'Refresh Plan';
  if (key === 'total') return 'Total Care';
  return key || '—';
}

function brandBlock() {
  return {
    name: 'Florida Eco Services',
    address: '2100 Olympus Blvd, Apt 2315, Clermont, FL 34714',
    phone: '(786) 757-4703',
    email: brandEmail()
  };
}

function normalizeText(v: any) {
  return String(v || '').trim();
}

function normalizeCustomerType(v: any): 'PROSPECT' | 'CLIENT' {
  const s = String(v || '').trim().toUpperCase();
  return s === 'CLIENT' ? 'CLIENT' : 'PROSPECT';
}

function normalizeCustomer(v: any) {
  const obj = v && typeof v === 'object' ? v : {};
  return {
    company: normalizeText(obj.company),
    contact: normalizeText(obj.contact),
    email: normalizeText(obj.email),
    phone: normalizeText(obj.phone)
  };
}

function normalizePayload(v: any) {
  return v && typeof v === 'object' ? v : {};
}

function shouldPersistProspect(customer: ReturnType<typeof normalizeCustomer>) {
  return !!(customer.company || customer.contact || customer.email || customer.phone);
}

function parseEmailList(raw: any): string[] {
  const s = String(raw || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  // Minimal validation (keeps UX friendly, not RFC-perfect).
  return s.filter((v) => v.includes('@') && !v.includes(' '));
}

function getIp(req: any) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0]?.trim();
  return forwarded || String(req.ip || '');
}

function classifySmtpError(err: any): { code: string; status: number } {
  const code = String(err?.code || err?.name || err?.responseCode || 'smtp_error').trim();
  // Map common nodemailer/network failures to a 502 (bad gateway to SMTP).
  const smtpCodes = new Set([
    'EAUTH',
    'ECONNECTION',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ETIMEDOUT',
    'ESOCKET',
    'EENVELOPE',
    'EMESSAGE',
    'EDNS',
    'ENOTFOUND'
  ]);
  const status = smtpCodes.has(code) ? 502 : 500;
  return { code, status };
}

async function createQuoteWithNextNumber(prisma: ReturnType<typeof getPrisma>, organizationId: string, data: any) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const last = await tx.quote.findFirst({
          where: { organizationId },
          orderBy: { number: 'desc' },
          select: { number: true }
        });
        const nextNumber = (last?.number || 0) + 1;
        return tx.quote.create({
          data: { organizationId, number: nextNumber, ...data }
        });
      });
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (attempt < 2 && (msg.includes('Unique constraint') || msg.includes('unique constraint'))) continue;
      throw err;
    }
  }
  throw new Error('quote_number_conflict');
}

router.get('/quotes', requireAuth, async (req: AuthedRequest, res: Response) => {
  const prisma = getPrisma();
  const limitRaw = Number(req.query?.limit || 30);
  const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 30));
  const includeDeleted = String(req.query?.includeDeleted || '') === '1';
  const onlyDeleted = String(req.query?.onlyDeleted || '') === '1';

  const quotes = await prisma.quote.findMany({
    where: {
      organizationId: req.auth!.organizationId,
      ...(onlyDeleted ? { deletedAt: { not: null } } : includeDeleted ? {} : { deletedAt: null })
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { id: true, number: true, status: true, title: true, updatedAt: true, deletedAt: true }
  });
  res.json({ quotes });
});

router.post(
  '/quotes',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const prisma = getPrisma();
    const customerType = normalizeCustomerType(req.body?.customerType);
    const customer = normalizeCustomer(req.body?.customer);
    const payload = normalizePayload(req.body?.payload);
    const leadId = normalizeText(req.body?.leadId);

    let leadCustomerType = customerType;
    let leadCustomer = customer;
    let leadRef: { id: string } | null = null;
    if (leadId) {
      const lead = await prisma.crmLead.findFirst({
        where: { id: leadId, organizationId: req.auth!.organizationId }
      });
      if (!lead) return res.status(404).json({ error: 'lead_not_found' });

      const contact = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
      leadCustomerType = 'PROSPECT';
      leadCustomer = normalizeCustomer({
        company: lead.hotelName,
        contact,
        email: lead.email1,
        phone: lead.phone
      });
      leadRef = { id: lead.id };
    }

    let prospectId: string | undefined;
    if (leadCustomerType === 'PROSPECT' && shouldPersistProspect(leadCustomer)) {
      const created = await prisma.prospect.create({
        data: {
          organizationId: req.auth!.organizationId,
          company: leadCustomer.company,
          contact: leadCustomer.contact,
          email: leadCustomer.email,
          phone: leadCustomer.phone
        }
      });
      prospectId = created.id;
    }

    const quote = await createQuoteWithNextNumber(prisma, req.auth!.organizationId, {
      status: 'DRAFT',
      customerType: leadCustomerType,
      customer: leadCustomer,
      title: normalizeText(req.body?.title) || leadCustomer.company || '',
      payload,
      currency: 'USD',
      prospectId,
      ...(leadRef ? { leadId: leadRef.id } : {})
    });

    res.status(201).json({ quote });
  }
);

router.get('/quotes/:quoteId', requireAuth, async (req: AuthedRequest, res: Response) => {
  const quoteId = String(req.params.quoteId || '').trim();
  if (!quoteId) return res.status(400).json({ error: 'missing_quote_id' });
  const includeDeleted = String(req.query?.includeDeleted || '') === '1';

  const prisma = getPrisma();
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, organizationId: req.auth!.organizationId }
  });
  if (!quote) return res.status(404).json({ error: 'quote_not_found' });
  if (quote.deletedAt && !includeDeleted) return res.status(404).json({ error: 'quote_deleted' });
  res.json({ quote });
});

router.delete(
  '/quotes/:quoteId',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const quoteId = String(req.params.quoteId || '').trim();
    if (!quoteId) return res.status(400).json({ error: 'missing_quote_id' });

    const prisma = getPrisma();
    const quote = await prisma.quote.findFirst({
      where: { id: quoteId, organizationId: req.auth!.organizationId, deletedAt: null }
    });
    if (!quote) return res.status(404).json({ error: 'quote_not_found' });
    if (quote.deletedAt) return res.json({ ok: true, quote });

    const updated = await prisma.quote.update({
      where: { id: quote.id },
      data: { deletedAt: new Date() }
    });
    res.json({ ok: true, quote: updated });
  }
);

router.post(
  '/quotes/:quoteId/restore',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const quoteId = String(req.params.quoteId || '').trim();
    if (!quoteId) return res.status(400).json({ error: 'missing_quote_id' });

    const prisma = getPrisma();
    const quote = await prisma.quote.findFirst({
      where: { id: quoteId, organizationId: req.auth!.organizationId }
    });
    if (!quote) return res.status(404).json({ error: 'quote_not_found' });

    const updated = await prisma.quote.update({
      where: { id: quote.id },
      data: { deletedAt: null }
    });
    res.json({ ok: true, quote: updated });
  }
);

router.delete(
  '/quotes/:quoteId/hard',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const quoteId = String(req.params.quoteId || '').trim();
    if (!quoteId) return res.status(400).json({ error: 'missing_quote_id' });

    const prisma = getPrisma();
    const quote = await prisma.quote.findFirst({
      where: { id: quoteId, organizationId: req.auth!.organizationId }
    });
    if (!quote) return res.status(404).json({ error: 'quote_not_found' });
    if (!quote.deletedAt) return res.status(400).json({ error: 'not_in_trash' });

    await prisma.quote.delete({ where: { id: quote.id } });
    res.json({ ok: true });
  }
);

router.patch(
  '/quotes/:quoteId',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const quoteId = String(req.params.quoteId || '').trim();
    if (!quoteId) return res.status(400).json({ error: 'missing_quote_id' });

    const prisma = getPrisma();
    const existing = await prisma.quote.findFirst({
      where: { id: quoteId, organizationId: req.auth!.organizationId, deletedAt: null }
    });
    if (!existing) return res.status(404).json({ error: 'quote_not_found' });

    const patch: Prisma.QuoteUpdateInput = {};
    if (req.body?.status !== undefined) patch.status = String(req.body.status || '').toUpperCase() as any;
    if (req.body?.title !== undefined) patch.title = normalizeText(req.body.title);
    if (req.body?.payload !== undefined) patch.payload = normalizePayload(req.body.payload) as any;
    if (req.body?.customerType !== undefined) patch.customerType = normalizeCustomerType(req.body.customerType);
    if (req.body?.customer !== undefined) patch.customer = normalizeCustomer(req.body.customer) as any;
    if (req.body?.leadId !== undefined) {
      const nextLeadId = String(req.body.leadId || '').trim();
      if (!nextLeadId) {
        (patch as any).lead = { disconnect: true };
      } else {
        const lead = await prisma.crmLead.findFirst({
          where: { id: nextLeadId, organizationId: req.auth!.organizationId }
        });
        if (!lead) return res.status(404).json({ error: 'lead_not_found' });

        const contact = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
        const leadCustomer = normalizeCustomer({
          company: lead.hotelName,
          contact,
          email: lead.email1,
          phone: lead.phone
        });

        (patch as any).lead = { connect: { id: lead.id } };
        patch.customerType = 'PROSPECT';
        patch.customer = leadCustomer as any;
        if (!patch.title) patch.title = leadCustomer.company || '';
      }
    }

    const nextCustomerType = (patch.customerType as any) || existing.customerType;
    const nextCustomer = (patch.customer as any) || (existing.customer as any) || {};

    // Ensure prospect exists for PROSPECT quotes (continuity requirement).
    if (nextCustomerType === 'PROSPECT' && shouldPersistProspect(nextCustomer)) {
      if (existing.prospectId) {
        await prisma.prospect.update({
          where: { id: existing.prospectId },
          data: {
            company: nextCustomer.company || '',
            contact: nextCustomer.contact || '',
            email: nextCustomer.email || '',
            phone: nextCustomer.phone || ''
          }
        });
      } else {
        const created = await prisma.prospect.create({
          data: {
            organizationId: req.auth!.organizationId,
            company: nextCustomer.company || '',
            contact: nextCustomer.contact || '',
            email: nextCustomer.email || '',
            phone: nextCustomer.phone || ''
          }
        });
        (patch as any).prospect = { connect: { id: created.id } };
      }
      // If user toggled back to prospect, unlink client.
      (patch as any).client = { disconnect: true };
    }

    const quote = await prisma.quote.update({ where: { id: existing.id }, data: patch });
    res.json({ quote });
  }
);

router.post(
  '/quotes/:quoteId/link-client',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const quoteId = String(req.params.quoteId || '').trim();
    const clientId = String(req.body?.clientId || '').trim();
    if (!quoteId) return res.status(400).json({ error: 'missing_quote_id' });
    if (!clientId) return res.status(400).json({ error: 'missing_client_id' });

    const prisma = getPrisma();
    const quote = await prisma.quote.findFirst({
      where: { id: quoteId, organizationId: req.auth!.organizationId }
    });
    if (!quote) return res.status(404).json({ error: 'quote_not_found' });

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: req.auth!.organizationId }
    });
    if (!client) return res.status(404).json({ error: 'client_not_found' });

    const customer = {
      company: client.company || '',
      contact: client.contact || '',
      email: client.email || '',
      phone: client.phone || ''
    };

    const updated = await prisma.quote.update({
      where: { id: quote.id },
      data: {
        customerType: 'CLIENT',
        customer,
        client: { connect: { id: client.id } },
        prospect: { disconnect: true }
      }
    });

    res.json({ quote: updated });
  }
);

router.get('/quotes/:quoteId/pdf', requireAuth, async (req: AuthedRequest, res: Response) => {
  const quoteId = String(req.params.quoteId || '').trim();
  if (!quoteId) return res.status(400).json({ error: 'missing_quote_id' });

  const prisma = getPrisma();
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, organizationId: req.auth!.organizationId, deletedAt: null }
  });
  if (!quote) return res.status(404).json({ error: 'quote_not_found' });

  const pdf = await renderQuotePdf({
    quoteNumber: quote.number || null,
    title: quote.title || '',
    customer: (quote.customer as any) || {},
    payload: (quote.payload as any) || {}
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="quote-${quote.number || quote.id}.pdf"`);
  res.send(pdf);
});

// ===== QUOTES (token link / public) =====

router.get('/public/quotes/by-token/:token', async (req, res: Response) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'missing_token' });

  const prisma = getPrisma();
  const quote = await prisma.quote.findFirst({
    where: { token, deletedAt: null },
    select: {
      id: true,
      number: true,
      status: true,
      title: true,
      payload: true,
      acceptedAt: true,
      acceptedPlanKey: true
    }
  });
  if (!quote) return res.status(404).json({ error: 'quote_not_found' });

  res.json({ quote });
});

router.get('/public/quotes/by-token/:token/pdf', async (req, res: Response) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'missing_token' });

  const prisma = getPrisma();
  const quote = await prisma.quote.findFirst({
    where: { token, deletedAt: null },
    select: {
      id: true,
      number: true,
      title: true,
      customer: true,
      payload: true,
      acceptedAt: true,
      acceptedPlanKey: true,
      signedByName: true,
      signedByTitle: true,
      signedByEmail: true
    }
  });
  if (!quote) return res.status(404).json({ error: 'quote_not_found' });

  const pdf = await renderQuotePdf({
    quoteNumber: quote.number || null,
    title: quote.title || '',
    customer: (quote.customer as any) || {},
    payload: (quote.payload as any) || {},
    acceptance: quote.acceptedAt
      ? {
          acceptedAt: quote.acceptedAt,
          acceptedPlanKey: quote.acceptedPlanKey || '',
          signedByName: quote.signedByName || '',
          signedByTitle: quote.signedByTitle || '',
          signedByEmail: quote.signedByEmail || ''
        }
      : null
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="quote-${quote.number || quote.id}.pdf"`);
  res.send(pdf);
});

router.post('/public/quotes/by-token/:token/accept', async (req, res: Response) => {
  const token = String(req.params.token || '').trim();
  if (!token) return res.status(400).json({ error: 'missing_token' });

  const acceptedPlanKey = String(req.body?.acceptedPlanKey || '').trim();
  const signedByName = normalizeText(req.body?.signedByName);
  const signedByTitle = normalizeText(req.body?.signedByTitle);
  const signedByEmail = normalizeText(req.body?.signedByEmail).toLowerCase();

  const allowedPlans = new Set(['ondemand', 'partner', 'total']);
  if (!allowedPlans.has(acceptedPlanKey)) return res.status(400).json({ error: 'invalid_plan' });
  if (!signedByName) return res.status(400).json({ error: 'missing_name' });
  if (!signedByTitle) return res.status(400).json({ error: 'missing_title' });
  if (!signedByEmail || !signedByEmail.includes('@')) return res.status(400).json({ error: 'missing_email' });

  const prisma = getPrisma();
  const quote = await prisma.quote.findFirst({ where: { token, deletedAt: null } });
  if (!quote) return res.status(404).json({ error: 'quote_not_found' });

  if (quote.status === 'ACCEPTED') return res.json({ ok: true, quote });

  const acceptedAt = new Date();
  const updated = await prisma.quote.update({
    where: { id: quote.id },
    data: {
      status: 'ACCEPTED',
      acceptedAt,
      acceptedPlanKey,
      signedByName,
      signedByTitle,
      signedByEmail,
      signedByIp: getIp(req),
      signedByUserAgent: String(req.headers?.['user-agent'] || '').slice(0, 400)
    }
  });

  // Auto-create / link a Client from the signed info (so you can follow up quickly).
  try {
    const customer = (quote.customer as any) || {};
    const company = String(customer.company || quote.title || '').trim();
    const email = signedByEmail || String(customer.email || '').trim().toLowerCase();
    const phone = String(customer.phone || '').trim();

    if (company || email) {
      const existingClient = email
        ? await prisma.client.findFirst({ where: { organizationId: quote.organizationId, email } })
        : null;

      const client =
        existingClient ||
        (await prisma.client.create({
          data: {
            organizationId: quote.organizationId,
            company: company || 'Client',
            contact: signedByName || String(customer.contact || '').trim(),
            email: email || '',
            phone: phone || ''
          }
        }));

      await prisma.quote.update({
        where: { id: quote.id },
        data: {
          customerType: 'CLIENT',
          client: { connect: { id: client.id } },
          prospect: { disconnect: true },
          customer: {
            company: client.company || '',
            contact: client.contact || '',
            email: client.email || '',
            phone: client.phone || ''
          } as any
        }
      });
    }
  } catch (err) {
    console.error('[quotes] accept client create/link failed:', err);
  }

  let pdf: Buffer | null = null;
  try {
    pdf = await renderQuotePdf({
      quoteNumber: updated.number || null,
      title: updated.title || '',
      customer: (updated.customer as any) || {},
      payload: (updated.payload as any) || {},
      acceptance: {
        acceptedAt,
        acceptedPlanKey,
        signedByName,
        signedByTitle,
        signedByEmail
      }
    });
  } catch (err) {
    console.error('[quotes] accept pdf render failed:', err);
  }

  const link = quoteSignLink(token);
  const subject = `Florida Eco Services — Quote #${updated.number} accepted`;
  const selectedLabel = planLabel(acceptedPlanKey);
  const brand = brandBlock();
  const text =
    `Thank you for your trust.\n\n` +
    `We received your acceptance for Quote #${updated.number}.\n\n` +
    `Selected offer: ${selectedLabel}\n` +
    `Signed by: ${signedByName} (${signedByTitle})\n` +
    `Timestamp (UTC): ${acceptedAt.toISOString()}\n\n` +
    `Next step: Eddy Sallault will contact you shortly to confirm dates and organization details.\n\n` +
    `Quote link: ${link}\n\n` +
    `${brand.name}\n${brand.address}\n${brand.phone}\n${brand.email}`;

  const html =
    `<p><b>Thank you for your trust.</b></p>` +
    `<p>We received your acceptance for <b>Quote #${updated.number}</b>.</p>` +
    `<ul>` +
    `<li><b>Selected offer:</b> ${selectedLabel}</li>` +
    `<li><b>Signed by:</b> ${signedByName} (${signedByTitle})</li>` +
    `<li><b>Timestamp (UTC):</b> ${acceptedAt.toISOString()}</li>` +
    `</ul>` +
    `<p><b>Next step:</b> Eddy Sallault will contact you shortly to confirm dates and organization details.</p>` +
    `<p>Quote link: <a href="${link}">${link}</a></p>` +
    `<p style="margin-top:14px;"><b>${brand.name}</b><br>${brand.address}<br>${brand.phone}<br><a href="mailto:${brand.email}">${brand.email}</a></p>`;

  try {
    await sendMail({
      to: [signedByEmail, brandEmail()],
      subject,
      text,
      html,
      attachments: pdf ? [{ filename: `quote-${updated.number}.pdf`, content: pdf, contentType: 'application/pdf' }] : undefined
    });
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg !== 'smtp_not_configured') console.error('[quotes] accept email send failed:', err);
  }

  res.json({ ok: true, quote: updated });
});

router.post(
  '/quotes/:quoteId/send',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const quoteId = String(req.params.quoteId || '').trim();
    if (!quoteId) return res.status(400).json({ error: 'missing_quote_id' });

    const to = parseEmailList(req.body?.to);
    const cc = parseEmailList(req.body?.cc);
    if (!to.length) return res.status(400).json({ error: 'missing_to' });

    const prisma = getPrisma();
    const quote = await prisma.quote.findFirst({
      where: { id: quoteId, organizationId: req.auth!.organizationId, deletedAt: null }
    });
    if (!quote) return res.status(404).json({ error: 'quote_not_found' });

    const customer = (quote.customer as any) || {};
    const company = String(customer.company || quote.title || '').trim() || 'Customer';

    let pdf: Buffer;
    try {
      pdf = await renderQuotePdf({
        quoteNumber: quote.number || null,
        title: quote.title || '',
        customer,
        payload: (quote.payload as any) || {},
        acceptance: quote.acceptedAt
          ? {
              acceptedAt: quote.acceptedAt,
              acceptedPlanKey: quote.acceptedPlanKey || '',
              signedByName: quote.signedByName || '',
              signedByTitle: quote.signedByTitle || '',
              signedByEmail: quote.signedByEmail || ''
            }
          : null
      });
    } catch (err) {
      console.error('[quotes] pdf render failed:', err);
      return res.status(500).json({ error: 'pdf_failed' });
    }

    const token = quote.token || createPublicToken();
    if (!quote.token) {
      await prisma.quote.update({ where: { id: quote.id }, data: { token } });
    }
    const link = quoteSignLink(token);

    const subject = `Quote #${quote.number} — ${company}`;
    const brand = brandBlock();
    const text =
      `Hello,\n\n` +
      `Please find attached Quote #${quote.number}.\n\n` +
      `To choose an offer and sign digitally, use this secure link:\n${link}\n\n` +
      `${brand.name}\n${brand.address}\n${brand.phone}\n${brand.email}`;
    const html =
      `<p>Hello,</p>` +
      `<p>Please find attached <b>Quote #${quote.number}</b>.</p>` +
      `<p>To choose an offer and sign digitally, use this secure link:</p>` +
      `<p><a href="${link}">${link}</a></p>` +
      `<p style="margin-top:14px;"><b>${brand.name}</b><br>${brand.address}<br>${brand.phone}<br><a href="mailto:${brand.email}">${brand.email}</a></p>`;

    try {
      await sendMail({
        to,
        cc: cc.length ? cc : undefined,
        subject,
        text,
        html,
        attachments: [{ filename: `quote-${quote.number}.pdf`, content: pdf, contentType: 'application/pdf' }]
      });
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg === 'smtp_not_configured') return res.status(400).json({ error: 'smtp_not_configured' });
      const meta = classifySmtpError(err);
      console.error('[quotes] send failed:', err);
      return res.status(meta.status).json({ error: 'smtp_error', code: meta.code });
    }

    const updated = await prisma.quote.update({
      where: { id: quote.id },
      data: { status: 'SENT', sentAt: new Date(), token: token || quote.token }
    });

    res.json({ quote: updated });
  }
);

export default router;
