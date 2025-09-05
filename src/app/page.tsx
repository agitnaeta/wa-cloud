'use client'
// File: pages/index.tsx
import { useEffect, useState, useRef, FormEvent } from 'react';
import io, { Socket } from 'socket.io-client';
import Lock from './Lock';

// --- Types ---
interface Chat {
  id: string;
  name?: string;
}

interface Message {
  id?: string;
  body: string;
  from: string;
  to: string;
  fromMe: boolean;
}

interface MessagesMap {
  [chatId: string]: Message[];
}

interface ChatsEvent {
  chatId: string;
  messages: Message[];
}

let socket: Socket | null = null;

// --- Main Page Component ---
export default function Home() {
  const [qrCode, setQrCode] = useState<string>('');
  const [isLocked, setIsLocked] = useState<boolean>(true);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<MessagesMap>({});

  const addLog = (log: string) =>
    setLogs((prevLogs) => [`[${new Date().toLocaleTimeString()}] ${log}`, ...prevLogs]);

  // --- Socket.IO Event Listeners ---
  useEffect(() => {
    socket = io();

    socket.on('connect', () => addLog('Socket connected!'));
    socket.on('qr', (qr: string) => {
      setQrCode(qr);
      setIsReady(false);
      console.log('Loading Keneh!')
    });
    socket.on('ready', () => {
      setIsReady(true);
      addLog('Client is ready!');
    });
    socket.on('log', (log: string) => addLog(log));
    socket.on('chats', (chatList: Chat[]) => {
      setChats(chatList);
      addLog('Chat list received.');
    });
    socket.on('messages', (data: ChatsEvent) =>
      setMessages((prev) => ({ ...prev, [data.chatId]: data.messages }))
    );
    socket.on('message', (newMessage: Message) => {
      addLog(`New Message from ${newMessage.from}: ${newMessage.body}`);
      const chatId = newMessage.fromMe ? newMessage.to : newMessage.from;
      setMessages((prev) => ({
        ...prev,
        [chatId]: [...(prev[chatId] || []), newMessage],
      }));
    });

   // ✅ Register and subscribe to push
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/sw.js")
      .then(() => navigator.serviceWorker.ready) // wait until active
      .then(async (reg) => {
        console.log("Service Worker ready:", reg);

        // Convert VAPID key from base64URL to Uint8Array
        const urlBase64ToUint8Array = (base64String: string) => {
          const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
          const base64 = (base64String + padding)
            .replace(/-/g, "+")
            .replace(/_/g, "/");
          const rawData = window.atob(base64);
          return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
        };

        const subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(
            process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
          ),
        });

        // Send subscription to server
        socket?.emit("subscribe", subscription);
        console.log("Push subscription sent to server", subscription);
      })
      .catch((err) => console.error("SW registration/subscription failed:", err));
  }

    return () => {
      if (socket) socket.disconnect();
    };
  }, [isReady]);

  // --- Effect to fetch messages when a chat is selected ---
  useEffect(() => {
    console.log(`Statusnya ${isLocked}`);
    if (selectedChat && !messages[selectedChat.id]) {
      addLog(`Fetching messages for ${selectedChat.name}...`);
      socket?.emit('get-messages', selectedChat.id);
    }
  }, [selectedChat, messages, isLocked]);

  if (isLocked) return <Lock setIsLocked={setIsLocked} />;

  // --- UI Rendering ---
  if (!isReady) return <QRCodeDisplay qrCode={qrCode} logs={logs} />;

  return (
    <div className="flex h-screen font-sans text-gray-800">
      {/* Left Panel: Chat List */}
      <div className="w-[30%] border-r border-gray-200 flex flex-col bg-white">
        <header className="p-4 border-b border-gray-200">
          <h1 className="text-xl font-semibold">Chats</h1>
        </header>
        <div className="flex-1 overflow-y-auto">
          {chats.map((chat) => (
            <ChatListItem
              key={chat.id}
              chat={chat}
              selectedChat={selectedChat}
              onSelect={setSelectedChat}
            />
          ))}
           <LogPanel logs={logs} />
        </div>
      </div>

      {/* Right Panel: Messages and Logs */}
      <div className="w-[70%] flex flex-col">
        {selectedChat ? (
          <MessagePanel
            selectedChat={selectedChat}
            messages={messages[selectedChat.id] || []}
            addLog={addLog}
          />
        ) : (
          <WelcomeScreen />
        )}
       
      </div>
    </div>
  );
}

// --- Sub-Components ---

const QRCodeDisplay = ({ qrCode, logs }: { qrCode: string; logs: string[] }) => (
  <div className="flex flex-col items-center justify-center h-screen bg-gray-50">
    <div className="p-8 bg-white rounded-lg shadow-lg text-center">
      <h2 className="text-2xl font-semibold mb-4 text-gray-700">Scan QR Code to Connect</h2>
      {qrCode ? (
        <img
          src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(
            qrCode
          )}&size=300x300`}
          alt="QR Code"
          className="mx-auto"
        />
      ) : (
        <p className="text-gray-500">Loading QR Code...</p>
      )}
    </div>
    <div className="w-full max-w-4xl mt-8 p2">
      <LogPanel logs={logs} />
    </div>
  </div>
);

const ChatListItem = ({
  chat,
  selectedChat,
  onSelect,
}: {
  chat: Chat;
  selectedChat: Chat | null;
  onSelect: (chat: Chat) => void;
}) => (
  <div
    className={`flex items-center p-4 cursor-pointer hover:bg-gray-100 ${
      selectedChat?.id === chat.id ? 'bg-gray-100' : ''
    }`}
    onClick={() => onSelect(chat)}
  >
    <div className="w-12 h-12 bg-gray-300 rounded-full mr-4 flex-shrink-0"></div>
    <div className="w-full overflow-hidden">
      <p className="font-semibold truncate">{chat.name || chat.id.split('@')[0]}</p>
    </div>
  </div>
);

const WelcomeScreen = () => (
  <div className="flex flex-col flex-1 items-center justify-center text-center bg-gray-100">
    <div className="w-20 h-20 mb-4 text-gray-400">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 
          0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 
          0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 
          12c0 4.556-4.03 8.25-9 
          8.25a9.764 9.764 0 01-2.555-.337A5.972 
          5.972 0 015.41 20.97a5.969 5.969 0 
          01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 
          16.178 3 14.189 3 12c0-4.556 4.03-8.25 
          9-8.25s9 3.694 9 8.25z"
        />
      </svg>
    </div>
    <h3 className="text-xl text-gray-600">Select a chat to start messaging</h3>
    <p className="text-gray-400">Your conversations will appear here.</p>
  </div>
);

const MessagePanel = ({
  selectedChat,
  messages,
  addLog,
}: {
  selectedChat: Chat;
  messages: Message[];
  addLog: (log: string) => void;
}) => {
  const [message, setMessage] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = (e: FormEvent) => {
    e.preventDefault();
    if (socket && selectedChat && message.trim()) {
      addLog(`Sending message to ${selectedChat.name || selectedChat.id}...`);
      socket.emit('send-message', { to: selectedChat.id, message });
      setMessage('');
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="p-4 border-b border-gray-200 flex items-center bg-white flex-shrink-0">
        <div className="w-10 h-10 bg-gray-300 rounded-full mr-4"></div>
        <h3 className="font-semibold">{selectedChat.name || selectedChat.id}</h3>
      </header>

      <div className="flex-1 p-6 overflow-y-auto bg-gray-50 flex flex-col space-y-2 min-h-0">
        {messages.map((msg, index) => (
          <div
            key={msg.id || index}
            className={`max-w-xs md:max-w-md p-3 rounded-lg break-words ${
              msg.fromMe ? 'self-end bg-green-100' : 'self-start bg-white shadow-sm'
            }`}
          >
            {msg.body}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form
        onSubmit={sendMessage}
        className="p-4 bg-white border-t border-gray-200 flex items-center flex-shrink-0"
      >
        <input
          type="text"
          placeholder="Type a message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="flex-1 px-4 py-2 mr-4 bg-gray-100 border border-transparent rounded-full focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
        />
        <button
          type="submit"
          className="p-3 bg-green-500 text-white rounded-full hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-gray-300"
          disabled={!message.trim()}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.949a.75.75 0 
            00.95.826L11.25 9.25v1.5l-7.14 
            1.785a.75.75 0 00-.95.826l1.414 
            4.949a.75.75 0 00.95.826l14.25-3.562a.75.75 
            0 000-1.405L3.105 2.289z" />
          </svg>
        </button>
      </form>
    </div>
  );
};

const LogPanel = ({ logs }: { logs: string[] }) => {
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="h-full border-t border-gray-200 bg-gray-800 text-green-400 font-mono text-xs">
      <h4 className="p-2 border-b border-gray-700 text-gray-400">Logs</h4>
      <div className="p-3 overflow-y-auto h-full">
        {logs.map((log, i) => (
          <p key={i} className="whitespace-pre-wrap break-all">
            {log}
          </p>
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
};
