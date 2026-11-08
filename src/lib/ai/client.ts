import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { cfg } from "../server/config";

let client: Anthropic | undefined;
export const anthropic = () => (client ??= new Anthropic({ apiKey: cfg.anthropicKey }));

export function parseJson<T>(text: string, open: "[" | "{"): T {
  const close = open === "[" ? "]" : "}";
  const t = text.replace(/```(?:json)?/g, "").trim();
  return JSON.parse(t.slice(t.indexOf(open), t.lastIndexOf(close) + 1)) as T;
}

export const textOf = (msg: Anthropic.Message) =>
  msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
