import { ChatOpenAI } from "@langchain/openai";
import { DEFAULT_MODEL_NAME, OPENROUTER_API_KEY } from "#/lib/constants";

export function getOpenRouterLLM(modelName: string = DEFAULT_MODEL_NAME, temperature = 0.7) {
    return new ChatOpenAI({
        modelName: modelName,
        temperature: temperature,
        openAIApiKey: OPENROUTER_API_KEY,
        configuration: {
            baseURL: "https://openrouter.ai/api/v1"
        },
        streaming: true
    });
}
