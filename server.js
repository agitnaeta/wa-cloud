// File: server.js
require('dotenv').config();

const { createServer } = require('http');
const webpush = require('web-push');
const { parse } = require('url');
const next = require('next');
const { Server } = require("socket.io");
const { Client, LocalAuth } = require('whatsapp-web.js');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

webpush.setVapidDetails(
  'mailto:lolo@sample.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

let subscriptions = [];

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url, true));
  });

  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const client = new Client({
    authStrategy: new LocalAuth({
      dataPath: './.wwebjs_auth' // folder penyimpanan session
    }),
    puppeteer: {
      headless: true,
      executablePath: '/usr/bin/chromium-browser', // ganti sesuai hasil which
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
      ],
    },
  });

  // --- WhatsApp Client Event Handlers ---
  client.on('qr', (qr) => {
    console.log("📲 QR RECEIVED:", qr);
    io.emit('qr', qr);
  });

  client.on('ready', async () => {
    console.log("✅ WhatsApp client is ready!");
    io.emit('ready', 'Client is ready!');
    try {
      const chats = await client.getChats();
      io.emit('chats', chats.map(chat => ({
        id: chat.id._serialized,
        name: chat.name,
        isGroup: chat.isGroup
      })));
    } catch (err) {
      console.error("Error fetching chats:", err);
    }
  });

  client.on('authenticated', () => {
    console.log("🔑 WhatsApp authenticated");
  });

  client.on('auth_failure', (msg) => {
    console.error("❌ AUTHENTICATION FAILURE:", msg);
  });

  client.on('disconnected', (reason) => {
    console.error("⚠️ Client was logged out:", reason);
  });

  client.on('message', (msg) => {
    console.log(`💬 New message from ${msg.from}: ${msg.body}`);

    const payload = JSON.stringify({
      title: 'New WhatsApp Message',
      body: `${msg.from}: ${msg.body}`,
    });

    subscriptions.forEach((sub) => {
      webpush.sendNotification(sub, payload).catch((err) => console.error(err));
    });

    io.emit('message', {
      from: msg.from,
      to: msg.to,
      body: msg.body,
      id: msg.id.id,
      fromMe: msg.fromMe,
      ack: msg.ack,
    });
  });

  client.on('message_ack', (msg, ack) => {
    io.emit('message_ack_update', {
      msgId: msg.id.id,
      chatId: msg.to,
      ack: ack
    });
  });

  client.initialize().catch(err => console.error("🚨 FATAL ERROR initializing WhatsApp:", err));

  // --- Socket.IO Connection Handler ---
  io.on('connection', (socket) => {
    console.log("🔌 Client connected via socket:", socket.id);

    socket.on("subscribe", (sub) => {
      subscriptions.push(sub);
      socket.emit("log", "Push subscription added!");
      console.log("📡 New subscription received:", sub.endpoint);
    });

    socket.on("check-session", async () => {
      try {
        const state = await client.getState();
    
        if (state === "CONNECTED") {
          socket.emit("session_exists", true);
        } else {
          // tunggu sampai ready
          client.once("ready", () => {
            socket.emit("session_exists", true);
          });
          socket.emit("session_exists", false);
        }
      } catch (err) {
        socket.emit("session_exists", false);
      }
    });

     // kirim chat list kalau diminta
  socket.on('get-chats', async () => {
    try {
      const chats = await client.getChats();
      socket.emit('chats', chats.map(chat => ({
        id: chat.id._serialized,
        name: chat.name,
        isGroup: chat.isGroup,
      })));
    } catch (err) {
      console.error("Error fetching chats:", err);
      socket.emit('chats', []);
    }
  });

    socket.on('disconnect', () => {
      console.log('Client disconnected');
    });

    socket.on('send-message', async (data) => {
      try {
        const sentMsg = await client.sendMessage(data.to, data.message);
        socket.emit('message_sent', {
          from: sentMsg.from,
          to: sentMsg.to,
          body: sentMsg.body,
          id: sentMsg.id.id,
          fromMe: sentMsg.fromMe,
          ack: sentMsg.ack
        });
      } catch (err) {
        console.error("Error sending message:", err);
        socket.emit('log', `Error sending message: ${err.message}`);
      }
    });

    socket.on('get-messages', async (chatId) => {
  try {
    const chat = await client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit: 20 });

    const formattedMessages = await Promise.all(
      messages.map(async (msg) => {
        let media = null;
        if (msg.hasMedia) {
          try {
            const mediaData = await msg.downloadMedia();
            media = {
              mimetype: mediaData.mimetype,
              data: mediaData.data, // base64
              filename: mediaData.filename || null,
            };
          } catch (err) {
            console.error("Error downloading media:", err);
          }
        }

        return {
          from: msg.from,
          to: msg.to,
          body: msg.body,
          id: msg.id.id,
          fromMe: msg.fromMe,
          ack: msg.ack,
          media, // << tambahan
        };
      })
    );

    // console.log(formattedMessages)

    socket.emit('messages', { chatId, messages: formattedMessages });
  } catch (err) {
    console.error("Error fetching messages:", err);
    socket.emit('log', `Error fetching messages: ${err.message}`);
  }
});
  });

  server.listen(3000, (err) => {
    if (err) throw err;
    console.log('🚀 Server ready on http://localhost:3000');
  });
});
