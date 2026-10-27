/** Default Gemini text model. Override with GEMINI_MODEL. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

export const geminiModel = () => process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;

/** Google Search grounding inside the planner's tool loop. Set GEMINI_GROUNDING=0 to turn it off. */
export const groundingEnabled = () => process.env.GEMINI_GROUNDING !== "0";
