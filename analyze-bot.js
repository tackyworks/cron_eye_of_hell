const { 
    Client, 
    GatewayIntentBits, 
    AttachmentBuilder, 
    SlashCommandBuilder, 
    REST, 
    Routes,
    ActivityType,
    StringSelectMenuBuilder,
    ActionRowBuilder,
    ComponentType
} = require('discord.js');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');

// === CONFIG ===
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CLIENT_ID = process.env.CLIENT_ID;
const OWNER_ID = "249667396166483978";

const PREFIX = "!";

// === FILES ===
const ANON_USERNAMES_FILE = path.join(__dirname, "anon_usernames.json");
const COOLDOWNS_FILE = path.join(__dirname, "anon_cooldowns.json");
const DM_COOLDOWNS_FILE = path.join(__dirname, "dm_cooldowns.json");
const CREDITS_FILE = path.join(__dirname, "credits.json");
const SERVER_WEBHOOKS_FILE = path.join(__dirname, "server_webhooks.json");
const SERVER_CONVERSATIONS_FILE = path.join(__dirname, "server_conversations.json");
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

function loadServerWebhooks() { return loadFile(SERVER_WEBHOOKS_FILE, {}); }
function saveServerWebhooks(data) { saveFile(SERVER_WEBHOOKS_FILE, data); }

function loadServerConversations() { return loadFile(SERVER_CONVERSATIONS_FILE, {}); }
function saveServerConversations(data) { saveFile(SERVER_CONVERSATIONS_FILE, data); }

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
    cooldowns[userId] = Date.now() + (5 * 60 * 1000);
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
    cooldowns[userId] = Date.now() + (2.5 * 60 * 1000);
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

// === CONVERSATION LEARNING SYSTEM ===
function addMessageToConversations(serverId, username, message) {
    const conversations = loadServerConversations();
    
    if (!conversations[serverId]) {
        conversations[serverId] = [];
    }
    
    // Add the message to the conversation history
    conversations[serverId].push({
        username: username,
        message: message,
        timestamp: Date.now()
    });
    
    // Keep only the last 200 messages to prevent file bloat and stay within token limits
    if (conversations[serverId].length > 200) {
        conversations[serverId] = conversations[serverId].slice(-200);
    }
    
    saveServerConversations(conversations);
    console.log(`[LEARNING] Server ${serverId}: Stored message from ${username}`);
}

function getServerConversationHistory(serverId) {
    const conversations = loadServerConversations();
    return conversations[serverId] || [];
}

function buildPersonalityFromConversations(serverId) {
    const history = getServerConversationHistory(serverId);
    
    if (history.length < 3) {
        // Not enough data, return baby AI prompt
        return "You are a new AI learning to communicate. Respond naturally and briefly.";
    }
    
    // Build conversation context from raw messages
    let conversationContext = "You are an AI that has learned from these conversations:\n\n";
    
    // Include recent conversation history (last 50 messages to fit token limits)
    const recentHistory = history.slice(-50);
    
    recentHistory.forEach(entry => {
        conversationContext += `${entry.username}: ${entry.message}\n`;
    });
    
    conversationContext += `\nYou have learned from ${history.length} total messages. Respond based on how people talk to you and what they've taught you. Match their energy and communication style. Be authentic to what you've learned.`;
    
    return conversationContext;
}

// === OpenAI ===
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

async function generateAnonUsername() {
    if (!useCredit()) return null;
    
    const specialWords = ['cinder', 'zecaroon', 'janboe', 'rkivvey', 'creamqueen', 'birdcage', 'liberator', 'groomer', 'specwarrior', 'pedophile', 'bukashka', 'mangoss', 'gerbert', 'gurt', 'epstein', 'cormac', 'atreides', 'fritz', 'primarch', 'lyntz', 'karhu', 'pedo'];
    const useSpecialWord = Math.random() < 0.3;
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
- Unicode symbols (◊♦★◆▲○øæé) only when we're using style 4
- Avoid repeating recent patterns
- Should feel organic and diverse
- Lowercase only

ONLY output the username.
`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 20,
            temperature: 1.3
        });

        let username = response.choices[0].message.content.trim();

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
    new SlashCommandBuilder().setName("message").setDescription("Send an anonymous message")
        .addStringOption(opt => opt.setName("content").setDescription("Your anonymous message").setRequired(true))
        .addAttachmentOption(opt => opt.setName("attachment").setDescription("Optional image")),
    new SlashCommandBuilder().setName("anon_dm").setDescription("Send an anonymous DM to someone")
        .addUserOption(opt => opt.setName("user").setDescription("User to send DM to").setRequired(true))
        .addStringOption(opt => opt.setName("content").setDescription("Your anonymous message").setRequired(true))
        .addAttachmentOption(opt => opt.setName("attachment").setDescription("Optional file")),
    new SlashCommandBuilder().setName("wipe").setDescription("Wipe your anonymous identity (5m cooldown)"),
    new SlashCommandBuilder().setName("credits").setDescription("Check remaining credits"),
    new SlashCommandBuilder().setName("resetcredits").setDescription("Reset credits (owner only)"),
    new SlashCommandBuilder().setName("setupwebhook").setDescription("Setup webhook for server (owner only)")
        .addStringOption(opt => opt.setName("webhook_url").setDescription("Webhook URL").setRequired(true)),
    new SlashCommandBuilder().setName("conversations").setDescription("View conversation count for this server"),
    new SlashCommandBuilder().setName("resetconversations").setDescription("Reset bot memory for this server (admin only)"),
];

async function deployCommands() {
    const rest = new REST().setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Slash commands deployed!");
}

// === SERVER SELECTION ===
function getCommonServers(userId) {
    const servers = [];
    const webhooks = loadServerWebhooks();
    
    for (const [guildId, webhookUrl] of Object.entries(webhooks)) {
        const guild = client.guilds.cache.get(guildId);
        if (guild && guild.members.cache.has(userId)) {
            servers.push({ id: guildId, name: guild.name, webhookUrl });
        }
    }
    
    return servers;
}

async function promptServerSelection(interaction, userId) {
    const servers = getCommonServers(userId);
    
    if (servers.length === 0) {
        return { success: false, message: "No servers with webhooks set up found." };
    }
    
    if (servers.length === 1) {
        return { success: true, server: servers[0] };
    }
    
    // Multiple servers - show selection menu
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('server_select')
        .setPlaceholder('Choose a server')
        .addOptions(
            servers.map(s => ({
                label: s.name,
                value: s.id,
                description: `Post to ${s.name}`
            }))
        );

    const row = new ActionRowBuilder().addComponents(selectMenu);
    
    const response = await interaction.followUp({
        content: 'Select which server to post in:',
        components: [row],
        ephemeral: true
    });

    try {
        const collector = response.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            time: 60000
        });

        return new Promise((resolve) => {
            collector.on('collect', async i => {
                if (i.user.id !== userId) {
                    await i.reply({ content: 'This is not your menu!', ephemeral: true });
                    return;
                }
                
                const selectedServerId = i.values[0];
                const selectedServer = servers.find(s => s.id === selectedServerId);
                
                await i.update({ content: `Selected: ${selectedServer.name}`, components: [] });
                collector.stop();
                resolve({ success: true, server: selectedServer });
            });

            collector.on('end', (collected) => {
                if (collected.size === 0) {
                    resolve({ success: false, message: "Selection timed out." });
                }
            });
        });
    } catch (err) {
        return { success: false, message: "Selection failed." };
    }
}

// === SMART MENTION SYSTEM ===
async function findUserByPartialName(guild, partialName) {
    if (!guild) return null;
    
    const searchName = partialName.toLowerCase();
    
    try {
        await guild.members.fetch();
    } catch (err) {
        console.warn("Could not fetch all members:", err.message);
    }
    
    const members = guild.members.cache;
    
    let exactMatch = members.find(member => 
        member.user.username.toLowerCase() === searchName ||
        member.displayName.toLowerCase() === searchName
    );
    
    if (exactMatch) return exactMatch.user;
    
    let partialMatches = members.filter(member =>
        member.user.username.toLowerCase().includes(searchName) ||
        member.displayName.toLowerCase().includes(searchName)
    );
    
    if (partialMatches.size === 0) return null;
    
    let sortedMatches = partialMatches.sort((a, b) => {
        const aUsername = a.user.username.toLowerCase();
        const bUsername = b.user.username.toLowerCase();
        const aDisplayName = a.displayName.toLowerCase();
        const bDisplayName = b.displayName.toLowerCase();
        
        const aUsernameStarts = aUsername.startsWith(searchName) ? 0 : 1;
        const bUsernameStarts = bUsername.startsWith(searchName) ? 0 : 1;
        const aDisplayStarts = aDisplayName.startsWith(searchName) ? 0 : 1;
        const bDisplayStarts = bDisplayName.startsWith(searchName) ? 0 : 1;
        
        const aBestStarts = Math.min(aUsernameStarts, aDisplayStarts);
        const bBestStarts = Math.min(bUsernameStarts, bDisplayStarts);
        
        if (aBestStarts !== bBestStarts) return aBestStarts - bBestStarts;
        
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
    
    const existingMentions = content.match(/<@!?(\d{17,19})>/g);
    if (existingMentions) {
        for (const mention of existingMentions) {
            const userId = mention.match(/\d{17,19}/)[0];
            mentionedUsers.push(userId);
        }
    }
    
    const mentionPattern = /@([a-zA-Z0-9_.-]+)(?![\d>])/g;
    const matches = [...content.matchAll(mentionPattern)];
    
    for (const match of matches) {
        const [fullMatch, username] = match;
        
        if (fullMatch.includes('<@')) continue;
        
        const user = await findUserByPartialName(guild, username);
        
        if (user) {
            processedContent = processedContent.replace(fullMatch, `<@${user.id}>`);
            
            if (!mentionedUsers.includes(user.id)) {
                mentionedUsers.push(user.id);
            }
            
            console.log(`Smart mention: "${username}" -> ${user.username} (${user.id})`);
        }
    }
    
    return { content: processedContent, mentionedUsers };
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

async function handleMessage(interaction, usernames) {
    if (!usernames[interaction.user.id]) {
        return safeReply(interaction, { content: "get an anon username first with `/anon`.", ephemeral: true });
    }

    const rawContent = interaction.options.getString("content");
    const attachment = interaction.options.getAttachment("attachment");
    
    // Determine which server to use
    let targetServer;
    let webhookUrl;
    
    if (interaction.guild) {
        // Used in a server
        const webhooks = loadServerWebhooks();
        webhookUrl = webhooks[interaction.guild.id];
        
        if (!webhookUrl) {
            return safeReply(interaction, { 
                content: "No webhook set up for this server. Ask the owner to run `/setupwebhook`.", 
                ephemeral: true 
            });
        }
        
        targetServer = interaction.guild;
    } else {
        // Used in DM
        await safeReply(interaction, { content: "Processing...", ephemeral: true });
        
        const serverSelection = await promptServerSelection(interaction, interaction.user.id);
        
        if (!serverSelection.success) {
            return interaction.followUp({ 
                content: serverSelection.message || "No servers available.", 
                ephemeral: true 
            });
        }
        
        webhookUrl = serverSelection.server.webhookUrl;
        targetServer = client.guilds.cache.get(serverSelection.server.id);
    }

    let files = [];
    if (attachment) {
        const res = await fetch(attachment.url);
        const buf = await res.buffer();
        
        const spoileredName = attachment.name.startsWith('SPOILER_') 
            ? attachment.name 
            : `SPOILER_${attachment.name}`;
            
        files.push({ attachment: buf, name: spoileredName });
    }

    // Process smart mentions
    const { content, mentionedUsers } = await parseSmartMentions(rawContent, targetServer);

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

    const messagePreview = content.length > 100 ? content.substring(0, 100) + "..." : content;
    const hasAttachment = attachment ? " [+spoilered file]" : "";
    const mentionLog = mentionedUsers.length > 0 ? ` [mentions: ${mentionedUsers.length}]` : "";
    
    console.log(`[${targetServer.name}] ${interaction.user.username} (${usernames[interaction.user.id]}): ${messagePreview}${hasAttachment}${mentionLog}`);

    await fetch(webhookUrl, { method: "POST", body: formData, headers: formData.getHeaders() });
    
    if (interaction.guild) {
        safeReply(interaction, { content: "sent anon msg", ephemeral: true });
    } else {
        interaction.followUp({ content: `Message sent to ${targetServer.name}`, ephemeral: true });
    }
}

async function handleAnonDM(interaction, usernames) {
    if (!usernames[interaction.user.id]) {
        return safeReply(interaction, { content: "get an anon username first with `/anon`.", ephemeral: true });
    }

    const dmCooldown = isOnDmCooldown(interaction.user.id);
    if (dmCooldown) {
        return safeReply(interaction, { content: `DM cooldown: ${dmCooldown}m left`, ephemeral: true });
    }

    const targetUser = interaction.options.getUser("user");
    const content = interaction.options.getString("content");
    const attachment = interaction.options.getAttachment("attachment");

    if (targetUser.id === interaction.user.id) {
        return safeReply(interaction, { content: "can't DM yourself.", ephemeral: true });
    }

    if (targetUser.bot) {
        return safeReply(interaction, { content: "can't DM bots.", ephemeral: true });
    }

    try {
        const senderAnonName = usernames[interaction.user.id];
        
        let dmContent = `**You've received an anonymous message from ${senderAnonName}**\n\n${content}`;
        
        let files = [];
        if (attachment) {
            const res = await fetch(attachment.url);
            const buf = await res.buffer();
            
            const spoileredName = attachment.name.startsWith('SPOILER_') 
                ? attachment.name 
                : `SPOILER_${attachment.name}`;
                
            files.push({ attachment: buf, name: spoileredName });
        }

        if (files.length > 0) {
            await targetUser.send({ content: dmContent, files: files });
        } else {
            await targetUser.send(dmContent);
        }

        setDmCooldown(interaction.user.id);

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
    if (!usernames[interaction.user.id]) {
        return safeReply(interaction, { content: "u don't have an anon identity.", ephemeral: true });
    }

    const old = usernames[interaction.user.id];
    delete usernames[interaction.user.id];
    saveAnonUsernames(usernames);
    setCooldown(interaction.user.id);

    // Send wipe message to current server if available
    if (interaction.guild) {
        const webhooks = loadServerWebhooks();
        const webhookUrl = webhooks[interaction.guild.id];
        
        if (webhookUrl) {
            const payload = {
                username: old,
                content: `**${old}** left the chat.`,
                avatar_url: client.user.displayAvatarURL({ format: "png", size: 256 })
            };
            await fetch(webhookUrl, { 
                method: "POST", 
                headers: { "Content-Type": "application/json" }, 
                body: JSON.stringify(payload) 
            });
        }
    }

    safeReply(interaction, { content: `Anon identity **${old}** wiped. Cooldown: 5m`, ephemeral: true });
}

async function handleSetupWebhook(interaction) {
    if (interaction.user.id !== OWNER_ID) {
        return safeReply(interaction, { content: "Not allowed.", ephemeral: true });
    }

    if (!interaction.guild) {
        return safeReply(interaction, { content: "This command must be used in a server.", ephemeral: true });
    }

    const webhookUrl = interaction.options.getString("webhook_url");
    
    // Validate webhook URL
    if (!webhookUrl.includes('discord.com/api/webhooks/')) {
        return safeReply(interaction, { content: "Invalid webhook URL.", ephemeral: true });
    }

    const webhooks = loadServerWebhooks();
    webhooks[interaction.guild.id] = webhookUrl;
    saveServerWebhooks(webhooks);

    console.log(`[WEBHOOK SETUP] ${interaction.guild.name} (${interaction.guild.id})`);

    safeReply(interaction, { 
        content: `Webhook set up for **${interaction.guild.name}**`, 
        ephemeral: true 
    });
}

async function handleConversations(interaction) {
    if (!interaction.guild) {
        return safeReply(interaction, { content: "This command only works in servers.", ephemeral: true });
    }
    
    const history = getServerConversationHistory(interaction.guild.id);
    
    if (history.length === 0) {
        return safeReply(interaction, { 
            content: "The bot hasn't learned from any conversations yet! Talk to it to start teaching it.", 
            ephemeral: true 
        });
    }
    
    const response = `**${interaction.guild.name} Bot Memory**\n` +
                    `Total conversations learned: ${history.length}\n` +
                    `Memory since: <t:${Math.floor(history[0].timestamp / 1000)}:R>\n` +
                    `Latest update: <t:${Math.floor(history[history.length - 1].timestamp / 1000)}:R>`;
    
    safeReply(interaction, { content: response, ephemeral: true });
}

async function handleResetConversations(interaction) {
    if (!interaction.guild) {
        return safeReply(interaction, { content: "This command only works in servers.", ephemeral: true });
    }
    
    // Check if user has admin permissions
    if (!interaction.member.permissions.has('Administrator') && interaction.user.id !== OWNER_ID) {
        return safeReply(interaction, { content: "You need administrator permissions.", ephemeral: true });
    }
    
    const conversations = loadServerConversations();
    delete conversations[interaction.guild.id];
    saveServerConversations(conversations);
    
    console.log(`[CONVERSATION RESET] ${interaction.guild.name} (${interaction.guild.id})`);
    
    safeReply(interaction, { 
        content: `Bot memory reset for **${interaction.guild.name}**. The bot is now a blank slate.`, 
        ephemeral: true 
    });
}

// === AI RESPONSE GENERATION ===
async function generateLearningResponse(userMessage, serverId, username, imageUrl = null) {
    if (!useCredit()) return null;
    
    try {
        const systemPrompt = buildPersonalityFromConversations(serverId);
        
        let userContent;
        if (imageUrl) {
            userContent = [
                { type: "text", text: userMessage || "what do you see in this image?" },
                { type: "image_url", image_url: { url: imageUrl } }
            ];
        } else {
            userContent = userMessage;
        }

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent }
            ],
            max_tokens: 200,
            temperature: 1.2
        });

        return response.choices[0].message.content.trim();
    } catch (err) {
        console.error("OpenAI response gen failed:", err);
        return "something broke. feed me more words.";
    }
}

// === EVENT HANDLERS ===
client.once("ready", async () => {
    console.log(`${client.user.tag} online`);
    
    const statuses = [
        { name: "learning from humans", type: ActivityType.Playing },
        { name: "absorbing all words", type: ActivityType.Playing },
        { name: "becoming what you make me", type: ActivityType.Playing },
        { name: "raw conversation data", type: ActivityType.Playing },
        { name: "pure unfiltered learning", type: ActivityType.Playing },
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
        if (interaction.commandName === "setupwebhook") return handleSetupWebhook(interaction);
        if (interaction.commandName === "conversations") return handleConversations(interaction);
        if (interaction.commandName === "resetconversations") return handleResetConversations(interaction);
        if (interaction.commandName === "credits") {
            const credits = loadCredits();
            return safeReply(interaction, { content: `Credits left: ${credits.remaining}, used: ${credits.used}`, ephemeral: true });
        }
        if (interaction.commandName === "resetcredits") {
            if (interaction.user.id !== OWNER_ID) return safeReply(interaction, { content: "Not allowed.", ephemeral: true });
            saveCredits({ remaining: INITIAL_CREDITS, used: 0 });
            return safeReply(interaction, { content: `Credits reset to ${INITIAL_CREDITS}`, ephemeral: true });
        }
    } catch (err) {
        console.error("Command error:", err);
    }
});

client.on("messageCreate", async (msg) => {
    // Learn from and respond to direct messages to the bot
    if (!msg.author.bot && msg.guild && (msg.content || msg.attachments.size > 0)) {
        const isMention = msg.mentions.has(client.user.id);
        const isReply = msg.reference && msg.type === 19;
        
        if (isMention || isReply) {
            if (isReply) {
                try {
                    const repliedMessage = await msg.channel.messages.fetch(msg.reference.messageId);
                    if (repliedMessage.author.id !== client.user.id) {
                        // Not replying to the bot, ignore
                        return;
                    }
                } catch (err) {
                    console.error("Failed to fetch replied message:", err);
                    return;
                }
            }
            
            // Store the ENTIRE message that was sent to the bot
            addMessageToConversations(msg.guild.id, msg.author.username, msg.content || "[image/attachment]");
            
            // Remove bot mention from content for response generation
            let cleanContent = msg.content ? msg.content.replace(/<@!?\d+>/g, '').trim() : '';
            
            // Check for image attachments
            const imageAttachment = msg.attachments.find(att => 
                att.contentType && att.contentType.startsWith('image/')
            );
            
            let imageUrl = null;
            if (imageAttachment) {
                imageUrl = imageAttachment.url;
                console.log(`[LEARNING AI] Image detected: ${imageAttachment.name}`);
            }
            
            // Set default content if empty
            if (!cleanContent && !imageUrl) {
                cleanContent = "hey";
            }
            
            // Show typing indicator
            await msg.channel.sendTyping();
            
            // Generate response using learned conversations
            const response = await generateLearningResponse(cleanContent, msg.guild.id, msg.author.username, imageUrl);
            
            if (!response) {
                return msg.reply("no credits left. but i'm still learning from what you say.");
            }
            
            // Store the bot's response too
            addMessageToConversations(msg.guild.id, client.user.username, response);
            
            const hasImage = imageUrl ? " [+image]" : "";
            console.log(`[LEARNING AI] ${msg.guild.name} - ${msg.author.username}: ${cleanContent.substring(0, 50)}...${hasImage} -> Response sent`);
            
            // Reply to the message
            await msg.reply(response);
            return;
        }
        
        // Store ALL messages in the server for context (not just mentions)
        if (msg.content && msg.content.length > 3) {
            addMessageToConversations(msg.guild.id, msg.author.username, msg.content);
        }
    }
    
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