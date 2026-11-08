import "server-only";
import nodemailer from "nodemailer";
import type { Suggestion } from "../types";
import { cfg } from "./config";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function emailSuggestions(to: string, items: Suggestion[]) {
  if (!to || !cfg.smtp.user || !cfg.smtp.pass || items.length === 0) return;
  const lines = items.map((s) => {
    const plan = s.plan ? ` ${s.plan.qty} @ ${s.plan.entry.toFixed(2)}` : "";
    const cash = s.plan?.cashNeeded ? `<br><small>Transfer ${s.plan.cashNeeded.toFixed(2)} from your bank first.</small>` : "";
    return `<li style="margin-bottom:10px"><b>${s.action} ${esc(s.ticker)} (${s.market})</b>${plan}<br>${esc(s.headline)}${cash}</li>`;
  }).join("");
  const subject = items.length === 1
    ? `${items[0].action} ${items[0].ticker} (${items[0].market})`
    : `${items.length} new suggestions: ${items.map((s) => `${s.action} ${s.ticker}`).join(", ")}`;
  const t = nodemailer.createTransport({
    host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.port === 465,
    auth: { user: cfg.smtp.user, pass: cfg.smtp.pass },
  });
  await t.sendMail({
    from: cfg.smtp.user, to, subject,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px"><ul style="padding-left:18px">${lines}</ul>
      <p><a href="${cfg.appUrl}/suggestions" style="display:inline-block;padding:10px 18px;background:#0b5e5a;color:#fff;border-radius:8px;text-decoration:none">Open suggestions</a></p></div>`,
  });
}
