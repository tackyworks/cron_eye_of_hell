const { 
    Client, 
    GatewayIntentBits, 
    AttachmentBuilder, 
    SlashCommandBuilder, 
    REST, 
    Routes,
    ActivityType 
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
const DM_COOLDOWNS_FILE = path.join(__dirname, "dm_cooldowns.json");
const CREDITS_FILE = path.join(__dirname, "credits.json");
const INITIAL_CREDITS = 10000;

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

function loadDmCooldowns() { return loadFile(DM_COOLDOWNS_FILE, {}); }
function saveDmCooldowns(data) { saveFile(DM_COOLDOWNS_FILE, data); }

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
    cooldowns[userId] = Date.now() + (5 * 60 * 1000); // Changed from (60 * 60 * 1000)
    saveCooldowns(cooldowns);
}

function isOnDmCooldown(userId) {
    const cooldowns = loadDmCooldowns();
    const now = Date.now();
    if (!cooldowns[userId]) return false;
    if (now < cooldowns[userId]) {
        return Math.ceil((cooldowns[userId] - now) / (1000 * 60));
    }
    delete cooldowns[userId];
    saveDmCooldowns(cooldowns);
    return false;
}

function setDmCooldown(userId) {
    const cooldowns = loadDmCooldowns();
    cooldowns[userId] = Date.now() + (2.5 * 60 * 1000); // 2.5 minute cooldown
    saveDmCooldowns(cooldowns);
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
    
    const specialWords = ['cinder', 'zecaroon', 'janboe', 'rkivvey', 'creamqueen', 'birdcage', 'liberator', 'groomer', 'specwarrior'];
    const useSpecialWord = Math.random() < 0.35;
    const chosenWord = useSpecialWord ? specialWords[Math.floor(Math.random() * specialWords.length)] : null;
    
    try {
        const prompt = `
Generate ONE random username with VARIED formatting.
${useSpecialWord ? `MUST incorporate this word: ${chosenWord}` : ''}

Pick ONE style randomly (distribute evenly):
1. Single word + number
2. Minimalist (4-7 chars)
3. Number prefix/suffix
4. Unicode accent (styles 1-7 + symbol)
5. Retro simple
6. Internet Slang

${useSpecialWord ? `
Integration methods for "${chosenWord}":
- As base: ${chosenWord}47, ${chosenWord.toLowerCase()}
- Modified: ${chosenWord.slice(0, 4)}99, x${chosenWord}x
` : ''}

Rules:
- 4-14 characters total ${useSpecialWord ? '(extended for special word)' : ''}
- Vary the pattern heavily
- Unicode symbols (◊♦★◆▲○øæé) only in style 4
- Avoid repeating recent patterns
- Should feel organic and diverse

ONLY output the username.
`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 20,
            temperature: 1.3
        });

        let username = response.choices[0].message.content.trim();

        // Validate length
        if (username.length < 4 || username.length > 15) {
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
    new SlashCommandBuilder().setName("anon_dm").setDescription("Send an anonymous DM to someone")
        .addUserOption(opt => opt.setName("user").setDescription("User to send DM to").setRequired(true))
        .addStringOption(opt => opt.setName("content").setDescription("Your anonymous message").setRequired(true))
        .addAttachmentOption(opt => opt.setName("attachment").setDescription("Optional file")),
    new SlashCommandBuilder().setName("wipe").setDescription("Wipe your anonymous identity (5m cooldown)"),
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

    console.log(`[ANON CREATION] ${interaction.user.username} is ${username}`);

    safeReply(interaction, { content: `ur new anon username: **${username}**`, ephemeral: true });
}

// === SMART MENTION SYSTEM ===
async function findUserByPartialName(guild, partialName) {
    if (!guild) return null;
    
    const searchName = partialName.toLowerCase();
    
    // Try to fetch all members if not cached
    try {
        await guild.members.fetch();
    } catch (err) {
        console.warn("Could not fetch all members:", err.message);
    }
    
    const members = guild.members.cache;
    
    // First try exact matches (case insensitive)
    let exactMatch = members.find(member => 
        member.user.username.toLowerCase() === searchName ||
        member.displayName.toLowerCase() === searchName
    );
    
    if (exactMatch) return exactMatch.user;
    
    // Then try partial matches - prioritize username matches
    let partialMatches = members.filter(member =>
        member.user.username.toLowerCase().includes(searchName) ||
        member.displayName.toLowerCase().includes(searchName)
    );
    
    if (partialMatches.size === 0) return null;
    
    // Sort by relevance (shorter names = better match)
    let sortedMatches = partialMatches.sort((a, b) => {
        const aUsername = a.user.username.toLowerCase();
        const bUsername = b.user.username.toLowerCase();
        const aDisplayName = a.displayName.toLowerCase();
        const bDisplayName = b.displayName.toLowerCase();
        
        // Prioritize starts-with matches
        const aUsernameStarts = aUsername.startsWith(searchName) ? 0 : 1;
        const bUsernameStarts = bUsername.startsWith(searchName) ? 0 : 1;
        const aDisplayStarts = aDisplayName.startsWith(searchName) ? 0 : 1;
        const bDisplayStarts = bDisplayName.startsWith(searchName) ? 0 : 1;
        
        const aBestStarts = Math.min(aUsernameStarts, aDisplayStarts);
        const bBestStarts = Math.min(bUsernameStarts, bDisplayStarts);
        
        if (aBestStarts !== bBestStarts) return aBestStarts - bBestStarts;
        
        // Then by length (shorter = better match)
        const aLen = Math.min(aUsername.length, aDisplayName.length);
        const bLen = Math.min(bUsername.length, bDisplayName.length);
        
        return aLen - bLen;
    });
    
    return sortedMatches.first()?.user || null;
}

async function parseSmartMentions(content, guild) {
    if (!guild) return { content, mentionedUsers: [] };
    
    const mentionedUsers = [];
    let processedContent = content;
    
    // First, extract existing Discord mentions and add them to allowed list
    const existingMentions = content.match(/<@!?(\d{17,19})>/g);
    if (existingMentions) {
        for (const mention of existingMentions) {
            const userId = mention.match(/\d{17,19}/)[0];
            mentionedUsers.push(userId);
        }
    }
    
    // Then process @word patterns that aren't already Discord mentions
    const mentionPattern = /@([a-zA-Z0-9_.-]+)(?![\d>])/g;
    const matches = [...content.matchAll(mentionPattern)];
    
    for (const match of matches) {
        const [fullMatch, username] = match;
        
        // Skip if it's already a proper Discord mention
        if (fullMatch.includes('<@')) continue;
        
        const user = await findUserByPartialName(guild, username);
        
        if (user) {
            // Replace with proper Discord mention
            processedContent = processedContent.replace(fullMatch, `<@${user.id}>`);
            
            // Add to mentioned users if not already there
            if (!mentionedUsers.includes(user.id)) {
                mentionedUsers.push(user.id);
            }
            
            console.log(`Smart mention: "${username}" -> ${user.username} (${user.id})`);
        }
    }
    
    return { content: processedContent, mentionedUsers };
}

async function handleMessage(interaction, usernames) {
    if (!usernames[interaction.user.id]) return safeReply(interaction, { content: "get an anon username first with `/anon`.", ephemeral: true });

    const rawContent = interaction.options.getString("content");
    const attachment = interaction.options.getAttachment("attachment");
    let files = [];

    if (attachment) {
        const res = await fetch(attachment.url);
        const buf = await res.buffer();
        
        // Auto-spoiler all attachments by adding SPOILER_ prefix
        const spoileredName = attachment.name.startsWith('SPOILER_') 
            ? attachment.name 
            : `SPOILER_${attachment.name}`;
            
        files.push({ attachment: buf, name: spoileredName });
    }

    // Process smart mentions
    const guild = interaction.guild;
    const { content, mentionedUsers } = await parseSmartMentions(rawContent, guild);

    const payload = {
        username: usernames[interaction.user.id],
        content,
        avatar_url: client.user.displayAvatarURL({ format: "png", size: 256 }),
        allowed_mentions: {
            parse: [],
            replied_user: false
        }
    };

    const formData = new FormData();
    formData.append("payload_json", JSON.stringify(payload));
    files.forEach((f, i) => formData.append(`files[${i}]`, f.attachment, { filename: f.name }));

    // === LOGGING FOR OWNER ===
    const messagePreview = content.length > 100 ? content.substring(0, 100) + "..." : content;
    const hasAttachment = attachment ? " [+spoilered file]" : "";
    const mentionLog = mentionedUsers.length > 0 ? ` [mentions: ${mentionedUsers.length}]` : "";
    
    console.log(`${interaction.user.username} (${usernames[interaction.user.id]}): ${messagePreview}${hasAttachment}${mentionLog}`);

    await fetch(ANON_WEBHOOK_URL, { method: "POST", body: formData, headers: formData.getHeaders() });
    safeReply(interaction, { content: "sent anon msg", ephemeral: true });
}

async function handleAnonDM(interaction, usernames) {
    // Check if user has anonymous identity
    if (!usernames[interaction.user.id]) {
        return safeReply(interaction, { content: "get an anon username first with `/anon`.", ephemeral: true });
    }

    // Check DM cooldown
    const dmCooldown = isOnDmCooldown(interaction.user.id);
    if (dmCooldown) {
        return safeReply(interaction, { content: `DM cooldown: ${dmCooldown}m left`, ephemeral: true });
    }

    const targetUser = interaction.options.getUser("user");
    const content = interaction.options.getString("content");
    const attachment = interaction.options.getAttachment("attachment");

    // Prevent self-DM
    if (targetUser.id === interaction.user.id) {
        return safeReply(interaction, { content: "can't DM yourself.", ephemeral: true });
    }

    // Prevent DMing bots
    if (targetUser.bot) {
        return safeReply(interaction, { content: "can't DM bots.", ephemeral: true });
    }

    try {
        const senderAnonName = usernames[interaction.user.id];
        
        // Format the DM message
        let dmContent = `**You've received an anonymous message from ${senderAnonName}**\n\n${content}`;
        
        let files = [];
        if (attachment) {
            const res = await fetch(attachment.url);
            const buf = await res.buffer();
            
            // Auto-spoiler all attachments in DMs too
            const spoileredName = attachment.name.startsWith('SPOILER_') 
                ? attachment.name 
                : `SPOILER_${attachment.name}`;
                
            files.push({ attachment: buf, name: spoileredName });
        }

        // Send the DM
        if (files.length > 0) {
            await targetUser.send({ content: dmContent, files: files });
        } else {
            await targetUser.send(dmContent);
        }

        // Set cooldown
        setDmCooldown(interaction.user.id);

        // Log for moderation
        const messagePreview = content.length > 100 ? content.substring(0, 100) + "..." : content;
        const hasAttachment = attachment ? " [+spoilered file]" : "";
        console.log(`[ANON DM] ${interaction.user.username} (${senderAnonName}) -> ${targetUser.username}: ${messagePreview}${hasAttachment}`);

        safeReply(interaction, { content: `Anonymous DM sent to ${targetUser.username}`, ephemeral: true });

    } catch (error) {
        console.error("DM send failed:", error);
        if (error.code === 50007) {
            safeReply(interaction, { content: "couldn't send DM - user has DMs disabled or blocked the bot.", ephemeral: true });
        } else {
            safeReply(interaction, { content: "failed to send DM.", ephemeral: true });
        }
    }
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

    safeReply(interaction, { content: `Anon identity **${old}** wiped. Cooldown: 5m`, ephemeral: true });
}

// === EVENT HANDLERS ===
client.once("ready", async () => {
    console.log(`${client.user.tag} online`);
    
    const statuses = [
        { name: "THE STRONGEST BATTLEGROUNDS", type: ActivityType.Playing },
         { name: "in the phillipines", type: ActivityType.Playing },
          { name: "aisar's a bum", type: ActivityType.Playing },
           { name: "ay fuck u eye of heaven", type: ActivityType.Playing },
            { name: "what? can't hear you little bud", type: ActivityType.Playing },
             { name: "IN HELL", type: ActivityType.Playing },
              { name: "BURNING", type: ActivityType.Playing },
               { name: "HELP ME HELP ME SANTINO HAS ME HOSTAGE", type: ActivityType.Playing },
                { name: "santino dont like me Bruh ima kms", type: ActivityType.Playing },
    ];
    
    let currentStatus = 0;
    
    const updateStatus = () => {
        const status = statuses[currentStatus];
        client.user.setActivity(status.name, { type: status.type });
        currentStatus = (currentStatus + 1) % statuses.length;
    };
    
    updateStatus();
    setInterval(updateStatus, 30000);
    
    await deployCommands();
});

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const usernames = loadAnonUsernames();

    try {
        if (interaction.commandName === "anon") return handleAnon(interaction, usernames);
        if (interaction.commandName === "message") return handleMessage(interaction, usernames);
        if (interaction.commandName === "anon_dm") return handleAnonDM(interaction, usernames);
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