import { Router, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { getPrisma } from '../db';
import { requireAuth, type AuthedRequest } from '../auth/middleware';
import { requireRole } from '../auth/roles';
import { renderQuotePdf } from '../pdf/quotePdf';
import { sendMail } from '../email/mailer';

const router = Router();

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

  const quotes = await prisma.quote.findMany({
    where: { organizationId: req.auth!.organizationId },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { id: true, number: true, status: true, title: true, updatedAt: true }
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
    const title = normalizeText(req.body?.title) || customer.company || '';

    let prospectId: string | undefined;
    if (customerType === 'PROSPECT' && shouldPersistProspect(customer)) {
      const created = await prisma.prospect.create({
        data: {
          organizationId: req.auth!.organizationId,
          company: customer.company,
          contact: customer.contact,
          email: customer.email,
          phone: customer.phone
        }
      });
      prospectId = created.id;
    }

    const quote = await createQuoteWithNextNumber(prisma, req.auth!.organizationId, {
      status: 'DRAFT',
      customerType,
      customer,
      title,
      payload,
      currency: 'USD',
      prospectId
    });

    res.status(201).json({ quote });
  }
);

router.get('/quotes/:quoteId', requireAuth, async (req: AuthedRequest, res: Response) => {
  const quoteId = String(req.params.quoteId || '').trim();
  if (!quoteId) return res.status(400).json({ error: 'missing_quote_id' });

  const prisma = getPrisma();
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, organizationId: req.auth!.organizationId }
  });
  if (!quote) return res.status(404).json({ error: 'quote_not_found' });
  res.json({ quote });
});

router.patch(
  '/quotes/:quoteId',
  requireAuth,
  requireRole(['SUPER_ADMIN']),
  async (req: AuthedRequest, res: Response) => {
    const quoteId = String(req.params.quoteId || '').trim();
    if (!quoteId) return res.status(400).json({ error: 'missing_quote_id' });

    const prisma = getPrisma();
    const existing = await prisma.quote.findFirst({
      where: { id: quoteId, organizationId: req.auth!.organizationId }
    });
    if (!existing) return res.status(404).json({ error: 'quote_not_found' });

    const patch: Prisma.QuoteUpdateInput = {};
    if (req.body?.status !== undefined) patch.status = String(req.body.status || '').toUpperCase() as any;
    if (req.body?.title !== undefined) patch.title = normalizeText(req.body.title);
    if (req.body?.payload !== undefined) patch.payload = normalizePayload(req.body.payload) as any;
    if (req.body?.customerType !== undefined) patch.customerType = normalizeCustomerType(req.body.customerType);
    if (req.body?.customer !== undefined) patch.customer = normalizeCustomer(req.body.customer) as any;

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
    where: { id: quoteId, organizationId: req.auth!.organizationId }
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
      where: { id: quoteId, organizationId: req.auth!.organizationId }
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
        payload: (quote.payload as any) || {}
      });
    } catch (err) {
      console.error('[quotes] pdf render failed:', err);
      return res.status(500).json({ error: 'pdf_failed' });
    }

    const subject = `Quote #${quote.number} — ${company}`;
    const text = `Hello,\n\nPlease find attached Quote #${quote.number}.\n\nFlorida Eco Services`;

    try {
      await sendMail({
        to,
        cc: cc.length ? cc : undefined,
        subject,
        text,
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
      data: { status: 'SENT', sentAt: new Date() }
    });

    res.json({ quote: updated });
  }
);

export default router;
