import { describe, expect, it } from "vitest";
import { channelFor } from "./channel";

describe("channelFor", () => {
  it.each([
    ["+19175550142", "sms"],
    ["+14165550142", "sms"],
    ["+18095550142", "whatsapp"],
    ["+18295550142", "whatsapp"],
    ["+17875550142", "whatsapp"],
    ["+5491134272488", "whatsapp"],
    ["+525512345678", "whatsapp"],
  ] as const)("%s va por %s", (e164, channel) => {
    expect(channelFor(e164)).toBe(channel);
  });
});
