import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
    server: {
        NODE_ENV: z.enum(["development", "production"]),
        DISCORD_TOKEN: z.string(),
        OPENROUTER_API_KEY: z.string(),
        DEFAULT_MODEL_NAME: z.string().default("mistralai/mistral-7b-instruct-v0.2")
    },
    runtimeEnv: process.env
});
