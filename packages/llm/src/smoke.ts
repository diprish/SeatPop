import { chat } from "./client";
import { resolveConfig } from "./config";

/**
 * Smoke test: one tiny request per configured chat model.
 * Prints reply, token counts and cost. Refuses to run without MODEL_API_KEY.
 */
async function main(): Promise<number> {
  const config = resolveConfig();
  if (!config.apiKey) {
    console.error(
      "smoke refused: MODEL_API_KEY is not set (copy .env.example to .env)",
    );
    return 2;
  }

  const chatModels: Array<[envName: string, model: string]> = [
    ["MODEL_SPARK", config.models.spark],
    ["MODEL_SPARK_CONTRIBUTOR", config.models.sparkContributor],
    ["MODEL_WONDER", config.models.wonder],
  ];
  let failures = 0;
  for (const [envName, model] of chatModels) {
    const result = await chat(
      {
        task: "smoke",
        model,
        messages: [{ role: "user", content: "Reply with exactly: ok" }],
      },
      { config },
    );
    if (!result.ok) {
      console.log(
        `${model} (${envName}): ERROR [${result.error.kind}] ${result.error.message}`,
      );
      failures += 1;
      continue;
    }
    const value = result.value;
    console.log(
      `${model} (${envName}): reply=${JSON.stringify(value.content)} ` +
        `tokens_in=${value.usage.promptTokens} ` +
        `tokens_out=${value.usage.completionTokens} ` +
        `reasoning=${value.usage.reasoningTokens} ` +
        `cached_in=${value.usage.cachedTokens} ` +
        `cost_usd=${value.costUsd.toFixed(6)} from_cache=${value.cached}`,
    );
  }

  console.log(
    `${config.models.image} (MODEL_IMAGE): skipped, image endpoint is not part of the phase-0 chat client`,
  );
  console.log(
    `${config.models.voice} (MODEL_VOICE): skipped, voice endpoint is not part of the phase-0 chat client`,
  );
  return failures === 0 ? 0 : 1;
}

const exitCode = await main();
process.exit(exitCode);
