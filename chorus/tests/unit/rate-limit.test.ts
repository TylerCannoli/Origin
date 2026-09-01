import { describe, expect, it } from "vitest";
import { rateLimit } from "@/lib/api/rate-limit";
import { ApiError } from "@/lib/api/errors";

describe("rateLimit", () => {
  it("allows up to the limit in a window and rejects after", async () => {
    const key = `test:${Date.now()}:${Math.random()}`;
    for (let i = 0; i < 3; i++) await rateLimit(key, 3, 60);
    await expect(rateLimit(key, 3, 60)).rejects.toThrow(ApiError);
    await expect(rateLimit(key, 3, 60)).rejects.toMatchObject({ status: 429 });
  });
});
