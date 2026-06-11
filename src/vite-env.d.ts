/// <reference types="vite/client" />
/// <reference types="dom-chromium-ai" />

/**
 * Module augmentation for the Prompt API.
 *
 * As of Chrome 151, raw numerical sampling params (temperature, topK) are
 * removed from web page contexts and replaced by a categorical `samplingMode`
 * semantic enum. The `@types/dom-chromium-ai` package hasn't caught up yet
 * (it still marks temperature/topK as extension-only deprecated), so we
 * augment the create-options interface here to expose the new field.
 *
 * Reference:
 *   https://chromestatus.com (Sampling Parameters Origin Trial)
 */
declare global {
  type AILanguageModelSamplingMode =
    | "most-predictable"
    | "predictable"
    | "balanced"
    | "creative"
    | "most-creative";

  interface LanguageModelCreateCoreOptions {
    /**
     * Categorical sampling mode replacing the removed raw `temperature` and
     * `topK` params. The browser maps this to the optimal raw values for the
     * currently-loaded underlying model. Mutually exclusive with the
     * extension-only `temperature` / `topK` fields.
     */
    samplingMode?: AILanguageModelSamplingMode;
  }
}

export {};
