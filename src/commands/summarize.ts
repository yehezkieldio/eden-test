import { StringOutputParser } from "@langchain/core/output_parsers";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { Command, CommandOptionsRunTypeEnum } from "@sapphire/framework";
import { SlashCommandBuilder } from "discord.js";
import { getOpenRouterLLM } from "#/lib/llm";
import { ResponseStreamer } from "#/lib/response-streamer";

export class SummarizeCommand extends Command {
    public constructor(context: Command.LoaderContext, options: Command.Options) {
        super(context, {
            ...options,
            description: "Summarizes the provided text.",
            runIn: CommandOptionsRunTypeEnum.GuildAny
        });
    }

    public override registerApplicationCommands(registry: Command.Registry): void {
        const command = new SlashCommandBuilder()
            .setName(this.name)
            .setDescription(this.description)
            .addStringOption((option) =>
                option
                    .setName("text")
                    .setDescription("The text you want to summarize")
                    .setRequired(true)
                    .setMaxLength(4000)
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
        const textToSummarize = interaction.options.getString("text", true);

        const requestedModel = interaction.options.getString("model");
        const ephemeral = interaction.options.getBoolean("ephemeral") ?? false;

        if (textToSummarize.length < 50) {
            return interaction.reply({
                content: "Please provide more text to summarize effectively.",
                ephemeral: true
            });
        }

        const streamer = new ResponseStreamer(interaction, "✍️ Summarizing...");
        if (ephemeral) {
            await interaction.deferReply({ ephemeral: true });
            await streamer.interaction.deleteReply();
            const ephemeralStreamer = new ResponseStreamer(interaction, "✍️ Summarizing...");

            ephemeralStreamer.setNextMessageOptions({ ephemeral: true });
            await this.runSummarization(ephemeralStreamer, textToSummarize, requestedModel);
        } else {
            await this.runSummarization(streamer, textToSummarize, requestedModel);
        }
    }

    private async runSummarization(streamer: ResponseStreamer, textToSummarize: string, requestedModel: string | null) {
        try {
            const llm = getOpenRouterLLM(requestedModel ?? undefined); // Use default if not provided

            const prompt = ChatPromptTemplate.fromMessages([
                [
                    "system",
                    "You are Eden, a helpful assistant designed to provide concise and accurate summaries of the given text."
                ],
                ["human", "Please summarize the following text:\n\n{text}"]
            ]);

            const outputParser = new StringOutputParser();
            const chain = RunnableSequence.from([prompt, llm, outputParser]);

            const stream = await chain.stream({ text: textToSummarize });

            for await (const chunk of stream) {
                await streamer.addChunk(chunk);
            }

            await streamer.finalize(); // Send remaining buffer and finalize
        } catch (error) {
            console.error("Summarization error:", error);
            // Try to inform the user via the streamer if possible, otherwise use interaction
            try {
                await streamer.finalize(); // Finalize first to clear any pending edits
                await streamer.interaction.followUp({
                    // @ts-ignore
                    content: `❌ An error occurred during summarization: ${error.message || "Unknown error"}`,
                    ephemeral: true // Keep errors ephemeral
                });
            } catch (followUpError) {
                console.error("Error sending error follow-up:", followUpError);
            }
        }
    }
}
