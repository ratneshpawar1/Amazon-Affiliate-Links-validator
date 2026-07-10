import { describe, it, expect } from "vitest";
import { keywordsFor, draftCopy, LlmError } from "../src/lib/llm";
import type { ApiKeys } from "../src/lib/types";

const KEYS: ApiKeys = {
  paapiAccessKey: "", paapiSecretKey: "", paapiPartnerTag: "", paapiRegion: "us-east-1",
  llmApiKey: "sk-test", llmModel: "claude-haiku-4-5",
};

function reply(text: string) {
  return async () => ({ ok: true, json: async () => ({ content: [{ text }] }) }) as unknown as Response;
}

describe("llm client", () => {
  it("keywordsFor returns only the first line, quotes stripped", async () => {
    const out = await keywordsFor("Widget Pro 3000 Mic", "", KEYS, {
      fetcher: reply('"budget usb microphone"\nsome explanation'),
    });
    expect(out).toBe("budget usb microphone");
  });

  it("draftCopy returns the model text", async () => {
    const out = await draftCopy("Old Mic", "New Mic", KEYS, { fetcher: reply("A solid modern equivalent.") });
    expect(out).toBe("A solid modern equivalent.");
  });

  it("throws LlmError with the API message on failure", async () => {
    const fetcher = async () =>
      ({ ok: false, status: 401, json: async () => ({ error: { message: "bad key" } }) }) as unknown as Response;
    await expect(keywordsFor("x", "", KEYS, { fetcher })).rejects.toBeInstanceOf(LlmError);
  });
});
