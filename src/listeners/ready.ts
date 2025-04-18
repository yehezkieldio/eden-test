import { Events, Listener } from "@sapphire/framework";
import type { Client } from "discord.js";

export class ReadyListener extends Listener<typeof Events.ClientReady> {
    public constructor(context: Listener.LoaderContext, options: Listener.Options) {
        super(context, {
            ...options,
            once: true, // Run only once when the bot becomes ready
            event: Events.ClientReady
        });
    }

    public run(client: Client) {
        this.container.logger.info(`Logged in as ${client.user?.tag}!`);
        this.container.logger.info(`Sapphire is ready!`);
    }
}
