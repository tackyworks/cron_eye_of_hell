const { 
    Client, 
    GatewayIntentBits, 
    AttachmentBuilder, 
    SlashCommandBuilder, 
    REST, 
    Routes 
} = require('discord.js');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');

// === CONFIG ===
// replace with process.env in prod
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CLIENT_ID = process.env.CLIENT_ID;
const ANON_WEBHOOK_URL = process.env.ANON_WEBHOOK_URL;

const PREFIX = "!";

// === FILES ===
const ANON_USERNAMES_FILE = path.join(__dirname, "anon_usernames.json");
const COOLDOWNS_FILE = path.join(__dirname, "anon_cooldowns.json");
const CREDITS_FILE = path.join(__dirname, "credits.json");
const INITIAL_CREDITS = 100;

// === UTILS ===
function loadFile(file, fallback) {
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, "utf8"));
        } else {
            fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
            return fallback;
        }
    } catch (e) {
        console.error(`Error loading ${file}:`, e);
        return fallback;
    }
}

function saveFile(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(`Error saving ${file}:`, e);
    }
}

function loadAnonUsernames() { return loadFile(ANON_USERNAMES_FILE, {}); }
function saveAnonUsernames(data) { saveFile(ANON_USERNAMES_FILE, data); }

function loadCooldowns() { return loadFile(COOLDOWNS_FILE, {}); }
function saveCooldowns(data) { saveFile(COOLDOWNS_FILE, data); }

function isOnCooldown(userId) {
    const cooldowns = loadCooldowns();
    const now = Date.now();
    if (!cooldowns[userId]) return false;
    if (now < cooldowns[userId]) {
        return Math.ceil((cooldowns[userId] - now) / (1000 * 60));
    }
    delete cooldowns[userId];
    saveCooldowns(cooldowns);
    return false;
}

function setCooldown(userId) {
    const cooldowns = loadCooldowns();
    cooldowns[userId] = Date.now() + (60 * 60 * 1000);
    saveCooldowns(cooldowns);
}

function loadCredits() { return loadFile(CREDITS_FILE, { remaining: INITIAL_CREDITS, used: 0 }); }
function saveCredits(data) { saveFile(CREDITS_FILE, data); }

function useCredit() {
    const credits = loadCredits();
    if (credits.remaining > 0) {
        credits.remaining--;
        credits.used++;
        saveCredits(credits);
        return true;
    }
    return false;
}

// === OpenAI ===
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

async function generateAnonUsername() {
    if (!useCredit()) return null;
    try {
        const prompt = `
Generate ONE random anonymous username.

Rules:
- Length: 4–10 characters
- Chaotic "internet style"
- Allowed characters: letters, numbers, _, -, .
- May mix casing
- May include: a number OR a unicode symbol OR a short non-English word
- Should feel like something you'd see on the internet (random, edgy, playful, weird)
- No emojis
- Do not explain, ONLY return the username
`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 20,
            temperature: 1.3
        });

        let username = response.choices[0].message.content.trim();

        // Validate length
        if (username.length < 4 || username.length > 10) {
            return await generateAnonUsername();
        }

        return username;
    } catch (err) {
        console.error("OpenAI username gen failed:", err);
        return "anon" + Math.floor(Math.random() * 9999);
    }
}



// === DISCORD ===
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent] 
});

function safeReply(interaction, options) {
    return interaction.reply(options).catch(err => {
        console.warn("Safe reply failed:", err.message);
    });
}

const commands = [
    new SlashCommandBuilder().setName("anon").setDescription("Get your anonymous username"),
    new SlashCommandBuilder().setName("message").setDescription("Send an anonymous message (DM only)")
        .addStringOption(opt => opt.setName("content").setDescription("Your anonymous message").setRequired(true))
        .addAttachmentOption(opt => opt.setName("attachment").setDescription("Optional image")),
    new SlashCommandBuilder().setName("wipe").setDescription("Wipe your anonymous identity (1h cooldown)"),
    new SlashCommandBuilder().setName("credits").setDescription("Check remaining credits"),
    new SlashCommandBuilder().setName("resetcredits").setDescription("Reset credits (owner only)")
];

async function deployCommands() {
    const rest = new REST().setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Slash commands deployed!");
}

// === COMMAND FUNCTIONS ===
async function handleAnon(interaction, usernames) {
    const cooldown = isOnCooldown(interaction.user.id);
    if (cooldown) return safeReply(interaction, { content: `cooldown: ${cooldown}m left`, ephemeral: true });

    if (usernames[interaction.user.id]) {
        return safeReply(interaction, { content: `ur anon username: **${usernames[interaction.user.id]}**`, ephemeral: true });
    }

    const username = await generateAnonUsername();
    if (!username) return safeReply(interaction, { content: "no credits left.", ephemeral: true });

    usernames[interaction.user.id] = username;
    saveAnonUsernames(usernames);

    safeReply(interaction, { content: `ur new anon username: **${username}**`, ephemeral: true });
}

async function handleMessage(interaction, usernames) {
    if (!usernames[interaction.user.id]) return safeReply(interaction, { content: "get an anon username first with `/anon`.", ephemeral: true });

    const content = interaction.options.getString("content");
    const attachment = interaction.options.getAttachment("attachment");
    let files = [];

    if (attachment) {
        const res = await fetch(attachment.url);
        const buf = await res.buffer();
        files.push({ attachment: buf, name: attachment.name });
    }

    const payload = {
        username: usernames[interaction.user.id],
        content,
        avatar_url: client.user.displayAvatarURL({ format: "png", size: 256 })
    };

    const formData = new FormData();
    formData.append("payload_json", JSON.stringify(payload));
    files.forEach((f, i) => formData.append(`files[${i}]`, f.attachment, { filename: f.name }));

    await fetch(ANON_WEBHOOK_URL, { method: "POST", body: formData, headers: formData.getHeaders() });
    safeReply(interaction, { content: "sent anon msg", ephemeral: true });
}

async function handleWipe(interaction, usernames) {
    if (!usernames[interaction.user.id]) return safeReply(interaction, { content: "u don't have an anon identity.", ephemeral: true });

    const old = usernames[interaction.user.id];
    delete usernames[interaction.user.id];
    saveAnonUsernames(usernames);
    setCooldown(interaction.user.id);

    const payload = {
        username: old,
        content: `**${old}** left the chat.`,
        avatar_url: client.user.displayAvatarURL({ format: "png", size: 256 })
    };
    await fetch(ANON_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });

    safeReply(interaction, { content: `Anon identity **${old}** wiped. Cooldown: 1h`, ephemeral: true });
}

// === EVENT HANDLERS ===
client.once("ready", async () => {
    console.log(`${client.user.tag} online`);
    await deployCommands();
});

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const usernames = loadAnonUsernames();

    try {
        if (interaction.commandName === "anon") return handleAnon(interaction, usernames);
        if (interaction.commandName === "message") return handleMessage(interaction, usernames);
        if (interaction.commandName === "wipe") return handleWipe(interaction, usernames);
        if (interaction.commandName === "credits") {
            const credits = loadCredits();
            return safeReply(interaction, { content: `Credits left: ${credits.remaining}, used: ${credits.used}`, ephemeral: true });
        }
        if (interaction.commandName === "resetcredits") {
            if (interaction.user.id !== "249667396166483978") return safeReply(interaction, { content: "Not allowed.", ephemeral: true });
            saveCredits({ remaining: INITIAL_CREDITS, used: 0 });
            return safeReply(interaction, { content: `Credits reset to ${INITIAL_CREDITS}`, ephemeral: true });
        }
    } catch (err) {
        console.error("Command error:", err);
    }
});

// === PREFIX SUPPORT ===
client.on("messageCreate", async (msg) => {
    if (msg.author.bot || !msg.content.startsWith(PREFIX)) return;
    const [cmd, ...args] = msg.content.slice(PREFIX.length).trim().split(/\s+/);
    const usernames = loadAnonUsernames();

    try {
        if (cmd === "anon") {
            const fakeInteraction = { user: msg.author, reply: (o) => msg.reply(o.content) };
            return handleAnon(fakeInteraction, usernames);
        }
        if (cmd === "message") {
            const fakeInteraction = { user: msg.author, options: { getString: () => args.join(" "), getAttachment: () => null }, reply: (o) => msg.reply(o.content) };
            return handleMessage(fakeInteraction, usernames);
        }
        if (cmd === "wipe") {
            const fakeInteraction = { user: msg.author, reply: (o) => msg.reply(o.content) };
            return handleWipe(fakeInteraction, usernames);
        }
    } catch (err) {
        console.error("Prefix command error:", err);
    }
});

process.on("unhandledRejection", (err) => console.error("UnhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("UncaughtException:", err));

client.login(DISCORD_TOKEN);
