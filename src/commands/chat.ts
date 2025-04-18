import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { Command, CommandOptionsRunTypeEnum } from "@sapphire/framework";
import { SlashCommandBuilder } from "discord.js";
import { getOpenRouterLLM } from "#/lib/llm";
import { addAiMessage, addUserMessage, getUserHistory } from "#/lib/memory";
import { ResponseStreamer } from "#/lib/response-streamer";

export class ChatCommand extends Command {
    public constructor(context: Command.LoaderContext, options: Command.Options) {
        super(context, {
            ...options,
            description: "Chat with the bot.",
            runIn: CommandOptionsRunTypeEnum.GuildAny
        });
    }

    public override registerApplicationCommands(registry: Command.Registry): void {
        const command = new SlashCommandBuilder()
            .setName(this.name)
            .setDescription(this.description)
            .addStringOption((option) =>
                option
                    .setName("message")
                    .setDescription("The message you want to send to the bot")
                    .setRequired(true)
                    .setMaxLength(2000)
            )
            .addStringOption((option) =>
                option
                    .setName("model")
                    .setDescription("Specify an OpenRouter model (optional, defaults to configured)")
                    .setRequired(false)
            )
            .addBooleanOption((option) =>
                option
                    .setName("ephemeral")
                    .setDescription("Should the response only be visible to you? (Default: false)")
                    .setRequired(false)
            );

        void registry.registerChatInputCommand(command);
    }

    public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
        const userMessage = interaction.options.getString("message", true);
        const requestedModel = interaction.options.getString("model");
        const ephemeral = interaction.options.getBoolean("ephemeral") ?? false;
        const userId = interaction.user.id;

        const streamer = new ResponseStreamer(interaction, "🤔 Thinking...");
        if (ephemeral) {
            // As before, make the initial reply ephemeral if requested
            await streamer.interaction.deleteReply();
            const ephemeralStreamer = new ResponseStreamer(interaction, "🤔 Thinking...");
            ephemeralStreamer.setNextMessageOptions({ ephemeral: true });
            await this.runConversation(ephemeralStreamer, userId, userMessage, requestedModel);
        } else {
            await this.runConversation(streamer, userId, userMessage, requestedModel);
        }
    }

    private async runConversation(
        streamer: ResponseStreamer,
        userId: string,
        userMessage: string,
        requestedModel: string | null
    ) {
        let fullResponse = "";
        try {
            const llm = getOpenRouterLLM(requestedModel ?? undefined, 0.8); // Slightly higher temp for chat
            const memory = getUserHistory(userId);
            const currentHistory = await memory.getMessages();

            const prompt = ChatPromptTemplate.fromMessages([
                [
                    "system",
                    "You are a helpful and friendly conversational AI assistant. Keep your responses concise but informative. You are talking to a user on Discord."
                ],
                new MessagesPlaceholder("chat_history"), // Inject history here
                ["human", "{input}"]
            ]);

            const outputParser = new StringOutputParser();
            // LCEL Chain: History Retrieval -> Prompt Formatting -> LLM Call -> Output Parsing
            const chain = RunnableSequence.from([
                {
                    input: (input: { input: string; chat_history: unknown }) => input.input, // Pass input through
                    chat_history: (input: { input: string; chat_history: unknown }) => input.chat_history // Pass history through
                },
                prompt,
                llm,
                outputParser
            ]);

            // Add user message to history *before* calling the LLM
            await addUserMessage(userId, userMessage);

            const stream = await chain.stream({
                input: userMessage,
                chat_history: currentHistory // Pass the history fetched *before* adding the current user message
            });

            for await (const chunk of stream) {
                await streamer.addChunk(chunk);
                fullResponse += chunk; // Accumulate the full response for saving to history
            }

            await streamer.finalize(); // Finalize streaming

            // Important: Add the *complete* AI response to history *after* it's fully generated
            if (fullResponse.trim()) {
                await addAiMessage(userId, fullResponse.trim());
            }
        } catch (error) {
            console.error("Chat error:", error);
            // Save user message even if AI fails
            // await addUserMessage(userId, userMessage); // Already added above
            try {
                await streamer.finalize(); // Ensure edits stop
                await streamer.interaction.followUp({
                    // @ts-ignore
                    content: `❌ An error occurred during the conversation: ${error.message || "Unknown error"}`,
                    ephemeral: true
                });
            } catch (followUpError) {
                console.error("Error sending error follow-up:", followUpError);
            }
            // Don't save an AI message if it errored
        }
    }
}
