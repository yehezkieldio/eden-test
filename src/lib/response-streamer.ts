import { CommandInteraction, type InteractionReplyOptions, Message } from "discord.js";
import { DISCORD_MSG_CHAR_LIMIT, STREAM_EDIT_INTERVAL_MS, STREAM_MIN_CHARS_PER_EDIT } from "./constants";

export class ResponseStreamer {
    public interaction: CommandInteraction;
    private currentMessage: Message | null = null;
    private buffer = "";
    private totalSentLength = 0; // Track length across messages
    private lastEditTimestamp = 0;
    private editTimeout: NodeJS.Timeout | null = null;
    private finished = false;
    private nextMessageOptions?: InteractionReplyOptions; // For follow-up messages

    constructor(interaction: CommandInteraction, initialContent = "Thinking...") {
        this.interaction = interaction;
        // Defer or reply initially to get a message object to edit
        interaction
            .reply({ content: initialContent, fetchReply: true })
            .then((msg) => {
                if (msg instanceof Message) {
                    // Ensure it's a message object
                    this.currentMessage = msg;
                    this.lastEditTimestamp = Date.now();
                    // Start processing any buffered content received before reply resolved
                    if (this.buffer.length > 0) {
                        this.scheduleEdit();
                    }
                } else {
                    console.error("Failed to fetch reply message.");
                    // Handle error - maybe send a follow-up?
                    interaction.followUp("Sorry, couldn't start the response stream.");
                    this.finished = true; // Prevent further processing
                }
            })
            .catch((err) => {
                console.error("Error sending initial reply:", err);
                this.finished = true; // Prevent further processing
            });
    }

    async addChunk(chunk: string): Promise<void> {
        if (this.finished || !chunk) return; // Stop if finished or chunk is empty

        this.buffer += chunk;
        this.scheduleEdit();
    }

    private scheduleEdit(): void {
        // If a timeout is already scheduled, don't schedule another one yet
        if (this.editTimeout) return;
        // Don't schedule if we don't have a message to edit yet
        if (!this.currentMessage && !this.interaction.deferred && !this.interaction.replied) return;

        const now = Date.now();
        const timeSinceLastEdit = now - this.lastEditTimestamp;

        // Calculate delay needed to respect the interval
        const delay = Math.max(0, STREAM_EDIT_INTERVAL_MS - timeSinceLastEdit);

        this.editTimeout = setTimeout(() => {
            this.editTimeout = null; // Clear the timeout ID
            if (!this.finished) {
                // Don't edit if finish() was called
                this.performEdit();
            }
        }, delay);
    }

    private async performEdit(): Promise<void> {
        // Always perform first edit to remove "Thinking...", otherwise respect minimum chars
        if (this.finished || (this.totalSentLength > 0 && this.buffer.length < STREAM_MIN_CHARS_PER_EDIT)) {
            // Don't edit if finished or if not the first edit and not enough new content
            // If finished=true, the final edit is handled by finish()
            return;
        }

        if (!this.currentMessage) {
            // This might happen if the initial reply failed but chunks still arrived
            console.warn("performEdit called but currentMessage is null.");
            // Maybe retry initial reply or send follow-up? For now, just log.
            return;
        }

        const potentialTotalLength = this.totalSentLength + this.buffer.length;

        if (potentialTotalLength <= DISCORD_MSG_CHAR_LIMIT) {
            // Append buffer to current message content, replacing initial content on first edit
            const fetchedContent = (await this.currentMessage.fetch(true)).content; // Fetch latest content before editing
            const newContent = this.totalSentLength === 0 ? this.buffer : fetchedContent + this.buffer;
            try {
                await this.currentMessage.edit(newContent.substring(0, DISCORD_MSG_CHAR_LIMIT)); // Ensure limit isn't breached
                this.totalSentLength = newContent.length;
                this.buffer = ""; // Clear buffer after successful edit
                this.lastEditTimestamp = Date.now();
            } catch (error) {
                console.error(`Error editing message (ID: ${this.currentMessage.id}):`, error);
                // Potential rate limit or message deleted - stop streaming for this message?
                // @ts-ignore
                if (error.code === 10008) {
                    // Unknown Message
                    console.warn("Message likely deleted, stopping stream.");
                    this.finished = true; // Stop processing
                    this.clearTimeout();
                }
                // Other errors might be transient, could implement retry logic, but for now just log.
            }
        } else {
            // Content exceeds limit, need to split and send new message
            const remainingSpace = DISCORD_MSG_CHAR_LIMIT - this.totalSentLength;
            const splitPoint = this.findSplitPoint(this.buffer, remainingSpace);

            const partToEdit = this.buffer.substring(0, splitPoint);
            const partForNewMessage = this.buffer.substring(splitPoint);

            // Edit the current message with the first part
            try {
                const currentContent = (await this.currentMessage.fetch(true)).content;
                const finalEditContent = currentContent + partToEdit;
                await this.currentMessage.edit(finalEditContent.substring(0, DISCORD_MSG_CHAR_LIMIT));
                this.lastEditTimestamp = Date.now();
            } catch (error) {
                console.error(`Error editing message before split (ID: ${this.currentMessage.id}):`, error);
                // @ts-ignore
                if (error.code === 10008) {
                    // Unknown Message
                    console.warn("Message likely deleted, stopping stream.");
                    this.finished = true; // Stop processing
                    this.clearTimeout();
                    return; // Don't try to send followup
                }
                // Handle other errors? Maybe just continue to followUp?
            }

            // Send the rest in a new message
            this.buffer = partForNewMessage; // Keep the remaining part in the buffer
            this.totalSentLength = 0; // Reset length counter for the new message

            try {
                // Send the *start* of the next message immediately
                const nextMessageContent = this.buffer.substring(0, DISCORD_MSG_CHAR_LIMIT);
                const remainingBuffer = this.buffer.substring(nextMessageContent.length);

                const followUpMsg = await this.interaction.followUp({
                    ...(this.nextMessageOptions || {}), // Apply any follow-up options
                    content: nextMessageContent,
                    fetchReply: true
                });

                if (followUpMsg instanceof Message) {
                    this.currentMessage = followUpMsg;
                    this.totalSentLength = nextMessageContent.length;
                    this.buffer = remainingBuffer; // Update buffer with what's left after initial followUp
                    this.lastEditTimestamp = Date.now();
                    // If there's still buffer left, schedule another edit for the *new* message
                    if (this.buffer.length > 0) {
                        this.scheduleEdit();
                    }
                } else {
                    console.error("Follow-up did not return a Message object.");
                    this.finished = true; // Stop if we can't get the next message
                    this.clearTimeout();
                }
            } catch (error) {
                console.error("Error sending follow-up message:", error);
                this.finished = true; // Stop streaming if follow-up fails
                this.clearTimeout();
            }
        }
    }

    // Finalize the stream: send any remaining buffer content
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: <explanation>
    async finalize(): Promise<string> {
        this.finished = true; // Mark as finished to stop scheduled edits
        this.clearTimeout(); // Clear any pending edit timeout

        let finalContent = "";
        if (this.currentMessage) {
            finalContent = (await this.currentMessage.fetch(true)).content; // Get latest before final edit/check
        }

        if (this.buffer.length > 0) {
            if (!this.currentMessage) {
                // Should not happen if initial reply succeeded, but handle defensively
                console.warn("Finalize called with buffer but no current message.");
                try {
                    // Try sending the rest as a final follow-up
                    const finalMsg = await this.interaction.followUp({
                        content: this.buffer.substring(0, DISCORD_MSG_CHAR_LIMIT),
                        ...(this.nextMessageOptions || {}),
                        fetchReply: true
                    });
                    if (finalMsg instanceof Message) {
                        finalContent = finalMsg.content; // Assume this is the final state
                    }
                } catch (err) {
                    console.error("Error sending final follow-up:", err);
                }
                this.buffer = "";
            } else {
                const potentialTotalLength = this.totalSentLength + this.buffer.length;

                if (potentialTotalLength <= DISCORD_MSG_CHAR_LIMIT) {
                    // Replace initial content on first finalize or append subsequent
                    const newContent = this.totalSentLength === 0 ? this.buffer : finalContent + this.buffer;
                    try {
                        await this.currentMessage.edit(newContent);
                        finalContent = newContent; // Update final content
                        this.totalSentLength = newContent.length;
                    } catch (error) {
                        console.error(`Error during final edit (ID: ${this.currentMessage.id}):`, error);
                        // @ts-ignore
                        if (error.code !== 10008) {
                            // Log unless message deleted
                            // Maybe try a followUp with the buffer content?
                            try {
                                await this.interaction.followUp(`...(final part) ${this.buffer}`);
                                finalContent += `\n...(final part) ${this.buffer}`;
                            } catch {}
                        }
                    }
                    this.buffer = "";
                } else {
                    // This edge case (final chunk makes current msg too long) is complex.
                    // Simplest: Edit what fits, send the rest as follow-up.
                    const remainingSpace = DISCORD_MSG_CHAR_LIMIT - this.totalSentLength;
                    const splitPoint = this.findSplitPoint(this.buffer, remainingSpace);
                    const partToEdit = this.buffer.substring(0, splitPoint);
                    const partForNewMessage = this.buffer.substring(splitPoint);

                    try {
                        const finalEditContent = finalContent + partToEdit;
                        await this.currentMessage.edit(finalEditContent);
                        finalContent = finalEditContent; // Update final content
                    } catch (error) {
                        console.error(`Error during final split edit (ID: ${this.currentMessage.id}):`, error);
                        // If edit fails, the followUp might contain duplicates or be out of order
                    }

                    try {
                        if (partForNewMessage.length > 0) {
                            await this.interaction.followUp(partForNewMessage.substring(0, DISCORD_MSG_CHAR_LIMIT));
                            // We don't track the content of this final follow-up precisely in 'finalContent' easily
                            // but it has been sent.
                        }
                    } catch (error) {
                        console.error("Error sending final follow-up after split:", error);
                    }
                    this.buffer = "";
                }
            }
        }
        // Return the content of the *last message* that was being actively edited or sent.
        // This might not be the *entire* response if it spanned multiple messages.
        return finalContent;
    }

    private findSplitPoint(str: string, maxLength: number): number {
        if (str.length <= maxLength) {
            return str.length;
        }
        // Try to split at the last newline before the limit
        let splitPoint = str.lastIndexOf("\n", maxLength);
        if (splitPoint !== -1 && splitPoint > 0) return splitPoint;

        // Try to split at the last space before the limit
        splitPoint = str.lastIndexOf(" ", maxLength);
        if (splitPoint !== -1 && splitPoint > 0) return splitPoint;

        // Force split at the maxLength if no better point found
        return maxLength;
    }

    private clearTimeout(): void {
        if (this.editTimeout) {
            clearTimeout(this.editTimeout);
            this.editTimeout = null;
        }
    }

    // Optional: Allow setting options for follow-up messages (e.g., ephemeral)
    setNextMessageOptions(options: InteractionReplyOptions): void {
        this.nextMessageOptions = options;
    }
}
