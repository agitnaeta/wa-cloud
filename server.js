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

  const io = new Server(server);
  const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });

  // --- Client Event Handlers ---
  client.on('qr', (qr) => io.emit('qr', qr));
  client.on('ready', async () => {
    io.emit('ready', 'Client is ready!');
    const chats = await client.getChats();
    io.emit('chats', chats.map(chat => ({ id: chat.id._serialized, name: chat.name, isGroup: chat.isGroup })));
  });

  client.on('message', (msg) => {
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

  // *** NEW: LISTEN FOR MESSAGE STATUS CHANGES ***
  client.on('message_ack', (msg, ack) => {
    // msg.ack values: 1 (SENT), 2 (DELIVERED), 3 (READ)
    io.emit('message_ack_update', { msgId: msg.id.id, chatId: msg.to, ack: ack });
  });
  
  client.initialize().catch(err => console.error("FATAL ERROR:", err));

  // --- Socket.IO Connection Handler ---
  io.on('connection', (socket) => {

    socket.on("subscribe", (sub) => {
      subscriptions.push(sub);
      socket.emit("log", "Push subscription added!");
      console.log("New subscription received:", sub.endpoint);
    });

    // *** UPDATED: SEND-MESSAGE NOW RETURNS THE SENT MESSAGE ***
    socket.on('send-message', async (data) => {
      try {
        const sentMsg = await client.sendMessage(data.to, data.message);
        // Send the message object back to the client so it can be added to the UI
        socket.emit('message_sent', { from: sentMsg.from, to: sentMsg.to, body: sentMsg.body, id: sentMsg.id.id, fromMe: sentMsg.fromMe, ack: sentMsg.ack });
      } catch (err) {
        socket.emit('log', `Error sending message: ${err.message}`);
      }
    });

    socket.on('get-messages', async (chatId) => {
      try {


        const chat = await client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit: 50 });
        const formattedMessages = messages.map(msg => ({ from: msg.from, to: msg.to, body: msg.body, id: msg.id.id, fromMe: msg.fromMe, ack: msg.ack }));
        socket.emit('messages', { chatId, messages: formattedMessages });

        
      } catch (err) {
        socket.emit('log', `Error fetching messages: ${err.message}`);
      }
    });
  });

  server.listen(3000, (err) => {
    if (err) throw err;
    console.log('> Server ready on http://localhost:3000');
  });
});