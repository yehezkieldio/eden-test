import { env } from "#/env";

export const DISCORD_TOKEN = env.DISCORD_TOKEN;
export const OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
export const DEFAULT_MODEL_NAME = env.DEFAULT_MODEL_NAME || "mistralai/mistral-7b-instruct-v0.2";

export const DISCORD_MSG_CHAR_LIMIT = 1980;
export const STREAM_EDIT_INTERVAL_MS = 1500;
export const STREAM_MIN_CHARS_PER_EDIT = 10;
