/** USD per 1M tokens (input, output). Used only for the cost estimate shown to project owners. */
const PRICES: Record<string, [number, number]> = {
  "claude-fable-5-1": [10, 50],
  "claude-fable-5": [10, 50],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-opus-4-7": [5, 25],
  "claude-opus-4-6": [5, 25],
  "claude-sonnet-5": [2, 10],
  "claude-sonnet-4-6": [3, 15],
  "claude-haiku-4-5": [1, 5],
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(PRICES).find((k) => model.startsWith(k));
  const [inP, outP] = key ? PRICES[key] : [5, 25];
  return (inputTokens * inP + outputTokens * outP) / 1_000_000;
}
