import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { TEMPLATE_AUDIT_SYSTEM_PROMPT } from "./audit-prompt";
import type { TemplateAuditInput, TemplateAuditResult } from "./types";
import type { ViralVideo } from "@/lib/review-engine/types";

let client: Anthropic | null = null;
function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export async function generateTemplateAuditWithLLM(args: {
  input: TemplateAuditInput;
  similarVideos: ViralVideo[];
  commonalities: {
    topic: string;
    playStyles: { name: string; weight: number }[];
    visualStyles: { name: string; weight: number }[];
  };
}): Promise<TemplateAuditResult> {
  const payload = {
    userInput: args.input,
    benchmark: {
      similarVideos: args.similarVideos.map((v) => ({
        platform: v.platform,
        title: v.title,
        description: v.description,
        topic: v.topic,
        tags: v.tags,
        views: v.views,
        likes: v.likes,
        duration: v.duration,
        playStyle: v.playStyle,
        visualStyle: v.visualStyle,
        hook: v.hook,
        bgm: v.bgm,
        author: v.authorHandle,
      })),
      commonalities: args.commonalities,
    },
  };

  const r = await getClient().messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-opus-4-7",
    max_tokens: 16384,
    system: TEMPLATE_AUDIT_SYSTEM_PROMPT,
    messages: [
      { role: "user", content: JSON.stringify(payload, null, 2) },
    ],
  });

  const block = r.content[0];
  const text = block?.type === "text" ? block.text : "";
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");

  const parsed = JSON.parse(clean) as Omit<
    TemplateAuditResult,
    "referenceVideos"
  >;

  return {
    ...parsed,
    referenceVideos: args.similarVideos,
  };
}
