import { Prisma } from '@prisma/client';

function parseSendTime(sendTime: string): { hour: number; minute: number } {
  const [hh, mm] = String(sendTime || '').split(':');
  const hour = Number(hh);
  const minute = Number(mm);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return { hour: 9, minute: 0 };
  return { hour: Math.max(0, Math.min(23, Math.trunc(hour))), minute: Math.max(0, Math.min(59, Math.trunc(minute))) };
}

function getZonedParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = dtf.formatToParts(date);
  const map: any = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

function zonedDateTimeToUtcDate(input: { year: number; month: number; day: number; hour: number; minute: number; second?: number }, timeZone: string) {
  const baseUtc = Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, input.second || 0);
  let utc = baseUtc;
  // Iterate to stabilize around DST transitions.
  for (let i = 0; i < 3; i++) {
    const offset = getTimeZoneOffsetMs(new Date(utc), timeZone);
    utc = baseUtc - offset;
  }
  return new Date(utc);
}

function addLocalDays(date: { year: number; month: number; day: number }, days: number, timeZone: string) {
  // Use noon local time to avoid DST boundaries.
  const noonUtc = zonedDateTimeToUtcDate({ year: date.year, month: date.month, day: date.day, hour: 12, minute: 0, second: 0 }, timeZone);
  const shifted = new Date(noonUtc.getTime() + days * 24 * 3600 * 1000);
  const p = getZonedParts(shifted, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

function nextSendAtFromNow(now: Date, timeZone: string, sendTime: string) {
  const p = getZonedParts(now, timeZone);
  const t = parseSendTime(sendTime);

  let d = { year: p.year, month: p.month, day: p.day };
  let candidate = zonedDateTimeToUtcDate({ ...d, hour: t.hour, minute: t.minute, second: 0 }, timeZone);
  if (candidate.getTime() <= now.getTime() + 30 * 1000) {
    d = addLocalDays(d, 1, timeZone);
    candidate = zonedDateTimeToUtcDate({ ...d, hour: t.hour, minute: t.minute, second: 0 }, timeZone);
  }
  return candidate;
}

function renderTemplate(tpl: string, vars: Record<string, string>) {
  let out = String(tpl || '');
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, v);
  }
  return out;
}

export async function scheduleFirstCampaignMessage(tx: Prisma.TransactionClient, leadCampaignId: string) {
  return scheduleCampaignStepMessage(tx, leadCampaignId, 1);
}

export async function scheduleCampaignStepMessage(tx: Prisma.TransactionClient, leadCampaignId: string, stepIndex: number) {
  const lc = await tx.crmLeadCampaign.findFirst({
    where: { id: leadCampaignId },
    include: {
      lead: true,
      campaign: { include: { emails: { orderBy: { stepIndex: 'asc' } } } }
    }
  });
  if (!lc) throw new Error('lead_campaign_not_found');
  if (lc.archivedAt) throw new Error('lead_campaign_archived');

  const emails = lc.campaign.emails || [];
  const target = emails.find((e) => e.stepIndex === stepIndex);
  if (!target) throw new Error('campaign_email_not_found');

  const existing = await tx.crmEmailMessage.findUnique({
    where: { leadCampaignId_stepIndex: { leadCampaignId: lc.id, stepIndex } }
  });
  if (existing && existing.status !== 'CANCELED') {
    await tx.crmLeadCampaign.update({ where: { id: lc.id }, data: { nextSendAt: existing.sendAt } });
    return existing;
  }

  const tz = String(lc.campaign.timezone || 'America/New_York');

  let sendAt: Date;
  const now = new Date();
  if (stepIndex === 1) {
    sendAt = nextSendAtFromNow(now, tz, target.sendTime || '09:00');
  } else {
    const prevStep = stepIndex - 1;
    const prevEmail = emails.find((e) => e.stepIndex === prevStep);
    const prevMsg = await tx.crmEmailMessage.findUnique({
      where: { leadCampaignId_stepIndex: { leadCampaignId: lc.id, stepIndex: prevStep } }
    });
    const prevSentAt = prevMsg?.sentAt || prevMsg?.sendAt || now;
    const prevLocal = getZonedParts(prevSentAt, tz);
    const base = { year: prevLocal.year, month: prevLocal.month, day: prevLocal.day };
    const delayDays = prevEmail ? Math.max(0, Number(prevEmail.delayDaysAfter || 0)) : 0;
    const nextDay = addLocalDays(base, delayDays, tz);
    const t = parseSendTime(target.sendTime || '09:00');
    sendAt = zonedDateTimeToUtcDate({ ...nextDay, hour: t.hour, minute: t.minute, second: 0 }, tz);

    // If validation comes late, don't schedule in the past.
    if (sendAt.getTime() <= now.getTime() + 10 * 1000) {
      sendAt = new Date(now.getTime() + 60 * 1000);
    }
  }

  const vars = {
    firstName: String(lc.lead.firstName || '').trim(),
    lastName: String(lc.lead.lastName || '').trim(),
    hotelName: String(lc.lead.hotelName || '').trim()
  };

  const subject = renderTemplate(target.subjectTemplate || '', vars).trim();
  const bodyText = renderTemplate(target.bodyTemplate || '', vars);

  if (!lc.lead.email1) throw new Error('lead_missing_email');
  if (!subject) throw new Error('missing_subject');
  if (!String(bodyText || '').trim()) throw new Error('missing_body');

  const msg = await tx.crmEmailMessage.create({
    data: {
      organizationId: lc.organizationId,
      leadId: lc.leadId,
      leadCampaignId: lc.id,
      campaignEmailId: target.id,
      stepIndex,
      toEmail: lc.lead.email1,
      subject,
      bodyText,
      bodyHtml: null,
      sendAt,
      status: 'SCHEDULED',
      attempts: 0
    }
  });

  await tx.crmLeadCampaign.update({
    where: { id: lc.id },
    data: { nextSendAt: sendAt }
  });

  return msg;
}

