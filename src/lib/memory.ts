import { ChatMessageHistory } from "langchain/stores/message/in_memory";

const conversationHistories = new Map<string, ChatMessageHistory>();

const MAX_HISTORY_LENGTH = 10;

export function getUserHistory(userId: string): ChatMessageHistory {
    if (!conversationHistories.has(userId)) {
        conversationHistories.set(userId, new ChatMessageHistory());
    }
    return conversationHistories.get(userId)!;
}

export async function addUserMessage(userId: string, message: string) {
    const history = getUserHistory(userId);
    await history.addUserMessage(message);
    trimHistory(userId);
}

export async function addAiMessage(userId: string, message: string) {
    const history = getUserHistory(userId);
    await history.addAIMessage(message);
    trimHistory(userId);
}

async function trimHistory(userId: string) {
    const history = getUserHistory(userId);
    const messages = await history.getMessages();
    if (messages.length > MAX_HISTORY_LENGTH) {
        const trimmedMessages = messages.slice(messages.length - MAX_HISTORY_LENGTH);
        const newHistory = new ChatMessageHistory(trimmedMessages);
        conversationHistories.set(userId, newHistory);
    }
}
