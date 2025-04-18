import { SapphireClient } from "@sapphire/framework";
import { env } from "#/env";
import { configuration } from "./configuration";

export async function main(): Promise<void> {
    const client = new SapphireClient(configuration);
    await client.login(env.DISCORD_TOKEN);

    process.on("SIGINT", async (): Promise<void> => {
        await client.destroy().then((): never => {
            process.exit();
        });
    });
}

main().catch((error: unknown): never => {
    console.error(error);
    process.exit(1);
});
