import { extractTransactions, type ExtractInput } from "@/lib/ai/extract";
import { getBroker } from "@/lib/server/db";
import { handler, HttpError, requireOwner } from "@/lib/server/http";

export const maxDuration = 60;

/** Turns pasted text, a CSV, a PDF statement or a screenshot into draft transactions. Nothing is saved here. */
export const POST = handler(async (req: Request) => {
  await requireOwner(req);
  const form = await req.formData();
  const broker = await getBroker(String(form.get("brokerId") ?? ""));
  if (!broker) throw new HttpError(400, "Pick a broker");
  const text = String(form.get("text") ?? "");
  const file = form.get("file");
  let input: ExtractInput | null = null;
  if (file instanceof File && file.size) {
    if (file.size > 4 * 1024 * 1024) throw new HttpError(413, "File is over 4 MB. Split it or paste the text.");
    const buf = Buffer.from(await file.arrayBuffer());
    const t = file.type || "";
    if (t === "application/pdf") input = { kind: "pdf", base64: buf.toString("base64") };
    else if (t === "image/png" || t === "image/jpeg" || t === "image/webp") input = { kind: "image", base64: buf.toString("base64"), mediaType: t };
    else input = { kind: "text", text: buf.toString("utf8") };
  } else if (text.trim()) {
    input = { kind: "text", text };
  }
  if (!input) throw new HttpError(400, "Paste some text or attach a file");
  const drafts = await extractTransactions(input, `${broker.name}, ${broker.market} stocks, currency ${broker.currency}`);
  return { brokerId: broker.id, drafts };
});
