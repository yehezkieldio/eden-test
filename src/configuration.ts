import { type SapphireClientOptions } from "@sapphire/framework";
import { Time } from "@sapphire/time-utilities";
import { ActivityType, type ClientOptions, GatewayIntentBits, Partials } from "discord.js";
import { env } from "#/env";

export const DEVELOPERS: string[] = ["327849142774923266"];
export const DEVELOPMENT_SERVERS: string[] = ["1209737959587450980"];

interface EdenClientOptions extends SapphireClientOptions, ClientOptions {}

export const configuration: EdenClientOptions = {
    allowedMentions: {
        parse: [],
        users: [],
        roles: [],
        repliedUser: true
    },
    defaultCooldown: {
        delay: Time.Second * 2,
        filteredUsers: DEVELOPERS
    },
    defaultPrefix: "eden!",
    intents: [
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages
    ],
    loadApplicationCommandRegistriesStatusListeners: env.NODE_ENV === "development",
    loadDefaultErrorListeners: env.NODE_ENV === "development",
    loadMessageCommandListeners: true,
    partials: [Partials.Message, Partials.User, Partials.GuildMember],
    presence: {
        activities: [
            {
                type: ActivityType.Listening,
                name: "to the stars ✨"
            }
        ],
        status: "dnd"
    },
    typing: true
};
