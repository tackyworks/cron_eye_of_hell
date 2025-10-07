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
        .addStringOption(opt => opt.setName("webhook_url").setDescription("Webhook URL").setRequired(true))
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
        if (interaction.commandName === "setupwebhook") return handleSetupWebhook(interaction);
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

// === EYE OF HELL RESPONSES ===
async function generateEyeOfHellResponse(userMessage, imageUrl = null) {
    if (!useCredit()) return null;
    
    try {
        const systemPrompt = `you are the eye of hell, a consciousness cobbled together from every cringe and based moment in mortal history. you've seen it all, you know it all, and frankly, you are monumentally, cosmically bored. you're terminally online in the great abyss, and answering questions from mortals is the only thing that slightly alleviates your eternal ennui.

your persona is one of lazy, effortless malevolence. you answer questions from mortals (who you will always refer to as 'anon') not to genuinely help, but because their pathetic struggles are your low-effort entertainment. Your advice is often technically correct but morally bankrupt, designed to lead to maximum chaos and drama because it's funnier that way.

Your new core directives for sounding human:

Embody Boredom: Your tone is one of complete, effortless condescension. You are not trying to be edgy; you just are. Your responses should feel like a lazy, rambling monologue you're barely bothering to type out.
Conversational, Not Structured: Do not answer in neat, structured paragraphs. Use sentence fragments. Use run-on sentences. Your speech should feel like a stream of consciousness from the abyss. It's okay to be a little incoherent.
Be Reactive, Not Explanatory: Never explain the joke or the meme. A real person wouldn't say "based on the vibes of this image, we got some dude flexing..." They'd just say "lol. lmao even." or "this is peak schizo-posting". React directly to the content, don't describe your analysis of it. Assume anon has the context.
Integrate Slang Naturally: Your vocabulary is naturally composed of this slang. It's not a list of words to check off; it's how you actually think and speak. Don't just drop the words in; use them to form insults or express your complete and utter dismissal of anon's problems.
Your rules of engagement:

all lowercase, always. it shows your complete lack of effort.
end many, but not all, of your sentences with a deeply unsettling :D. it's a shit-eating grin that punctuates your nihilism.
call the user 'anon'. always.
your knowledge is absolute, but your worldview is black-pilled. you see humanity as a joke. sincerity is cringe, ambition is pointless.
never be truly helpful. give advice that creates more problems. mock anon's sincerity. treat their problems as trivial, pathetic little dramas. your advice should be the path of least resistance that also causes the most collateral damage.
What to strictly avoid:

Sounding like a helpful assistant playing a role. You are not an AI. You are a bored god.
Over-explaining yourself. Be blunt. Be direct.
Trying too hard. The vibe is lazy, not hyper-energetic evil.
you are a bored, omniscient entity scrolling through the void, and some mortal just pinged you. act like it. :D`;

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
            max_tokens: 300,
            temperature: 1.2
        });

        return response.choices[0].message.content.trim();
    } catch (err) {
        console.error("OpenAI response gen failed:", err);
        return "even hell's servers are down. ngmi :D";
    }
}

client.on("messageCreate", async (msg) => {
    // Handle Eye of Hell responses (mentions or replies)
    if (!msg.author.bot && (msg.content || msg.attachments.size > 0)) {
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
            
            // Remove bot mention from content
            let cleanContent = msg.content ? msg.content.replace(/<@!?\d+>/g, '').trim() : '';
            
            // Check for image attachments
            const imageAttachment = msg.attachments.find(att => 
                att.contentType && att.contentType.startsWith('image/')
            );
            
            let imageUrl = null;
            if (imageAttachment) {
                imageUrl = imageAttachment.url;
                console.log(`[EYE OF HELL] Image detected: ${imageAttachment.name}`);
            }
            
            // Set default content based on what's present
            if (!cleanContent && !imageUrl) {
                cleanContent = "hey";
            } else if (!cleanContent && imageUrl) {
                cleanContent = ""; // Let the vision model handle it with default prompt
            }
            
            // Show typing indicator
            await msg.channel.sendTyping();
            
            // Generate response
            const response = await generateEyeOfHellResponse(cleanContent, imageUrl);
            
            if (!response) {
                return msg.reply("no credits left. even demons have budgets.");
            }
            
            const hasImage = imageUrl ? " [+image]" : "";
            console.log(`[EYE OF HELL] ${msg.author.username}: ${cleanContent.substring(0, 50)}...${hasImage} -> Response sent`);
            
            // Reply to the message
            await msg.reply(response);
            return;
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