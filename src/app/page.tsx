'use client'
import { useEffect, useState, useRef, FormEvent } from 'react';
import io, { Socket } from 'socket.io-client';
import Lock from './Lock';

// --- Types ---
interface Chat {
  id: string;
  name?: string;
  isGroup?: boolean;
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

export default function Home() {
  const [qrCode, setQrCode] = useState<string>('');
  const [isLocked, setIsLocked] = useState<boolean>(true);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<MessagesMap>({});

  // 🔑 ref supaya listener socket bisa tau chat terbaru
  const selectedChatRef = useRef<Chat | null>(null);
  useEffect(() => {
    selectedChatRef.current = selectedChat;
  }, [selectedChat]);

  const addLog = (log: string) =>
    setLogs((prevLogs) => [`[${new Date().toLocaleTimeString()}] ${log}`, ...prevLogs]);

  // --- Socket.IO Event Listeners ---
  useEffect(() => {
    socket = io();

    socket.on('connect', () => {
      addLog('Socket connected!');
      socket?.emit('check-session'); // minta status session
      socket?.emit('get-chats');
    });

    socket.on('qr', (qr: string) => {
      setQrCode(qr);
      setIsReady(false);
    });

    socket.on('authenticated', () => {
      setIsReady(true)
    });

    socket.on('session_exists', (exists: boolean) => {
      if (exists) {
        setIsReady(true);
        addLog('Session already exists, client ready!');
        socket?.emit('get-chats');
      } else {
        setIsReady(false);
      }
    });

    socket.on('ready', () => {
      setIsReady(true);
      addLog('Client is ready!');
      socket?.emit('get-chats');
    });

    socket.on('log', (log: string) => addLog(log));

    socket.on('chats', (chatList: Chat[]) => {
      setChats(chatList);
      addLog(`Chat list received: ${chatList.length} chats`);
    });

    socket.on('messages', (data: ChatsEvent) =>
      setMessages((prev) => ({ ...prev, [data.chatId]: data.messages }))
    );

    // Pesan masuk dari WA
    socket.on('message', (newMessage: Message) => {
      let chatId = newMessage.fromMe ? newMessage.to : newMessage.from;

      // paksa sync ke chat yang lagi dibuka
      if (selectedChatRef.current?.id) {
        chatId = selectedChatRef.current.id;
      }

      setMessages((prev) => ({
        ...prev,
        [chatId]: [...(prev[chatId] || []), newMessage],
      }));
    });

    // Pesan keluar yang udah dikonfirmasi server
    socket.on('message_sent', (newMessage: Message) => {
      const chatId = selectedChatRef.current?.id;
      if (!chatId) return;

      setMessages((prev) => ({
        ...prev,
        [chatId]: [...(prev[chatId] || []), { ...newMessage, fromMe: true }],
      }));
    });

    return () => {
      socket?.disconnect();
    };
  }, []);

  // --- Fetch messages ketika ganti chat ---
  useEffect(() => {
    if (selectedChat && !messages[selectedChat.id]) {
      addLog(`Fetching messages for ${selectedChat.name || selectedChat.id}...`);
      socket?.emit('get-messages', selectedChat.id);
    }
  }, [selectedChat, messages]);

  if (isLocked) return <Lock setIsLocked={setIsLocked} />;
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
        </div>
        <div className="h-40 overflow-y-auto">
          <LogPanel logs={logs} />
        </div>
      </div>

      {/* Right Panel: Messages */}
      <div className="w-[70%] flex flex-col">
        {selectedChat ? (
          <MessagePanel
            selectedChat={selectedChat}
            messages={messages[selectedChat.id] || []}
            setMessages={setMessages}
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
    <div className="w-full max-w-4xl mt-8">
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
    <div className="w-12 h-12 bg-gray-300 rounded-full mr-4 flex-shrink-0 flex items-center justify-center">
      {chat.isGroup ? "👥" : "👤"}
    </div>
    <div className="w-full overflow-hidden">
      <p className="font-semibold truncate">{chat.name || chat.id.split('@')[0] || "Unknown"}</p>
    </div>
  </div>
);

const WelcomeScreen = () => (
  <div className="flex flex-col flex-1 items-center justify-center text-center bg-gray-100">
    <h3 className="text-xl text-gray-600">Select a chat to start messaging</h3>
    <p className="text-gray-400">Your conversations will appear here.</p>
  </div>
);

const MessagePanel = ({
  selectedChat,
  messages,
  setMessages,
  addLog,
}: {
  selectedChat: Chat;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<MessagesMap>>;
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

      // ✅ Optimistic update (langsung muncul hijau)
      const tempMessage: Message = {
        id: `temp-${Date.now()}`,
        body: message,
        from: "me",
        to: selectedChat.id,
        fromMe: true,
      };

      setMessages((prev) => ({
        ...prev,
        [selectedChat.id]: [...(prev[selectedChat.id] || []), tempMessage],
      }));

      socket.emit('send-message', { to: selectedChat.id, message });
      setMessage('');
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="p-4 border-b border-gray-200 flex items-center bg-white flex-shrink-0">
        <div className="w-10 h-10 bg-gray-300 rounded-full mr-4 flex items-center justify-center">
          {selectedChat.isGroup ? "👥" : "👤"}
        </div>
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
          className="flex-1 px-4 py-2 mr-4 bg-gray-100 border border-transparent rounded-full focus:outline-none focus:ring-2 focus:ring-green-500"
        />
        <button
          type="submit"
          className="p-3 bg-green-500 text-white rounded-full hover:bg-green-600"
          disabled={!message.trim()}
        >
          Send
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
    <div className="h-full bg-gray-800 text-green-400 font-mono text-xs">
      <h4 className="p-2 border-b border-gray-700 text-gray-400">Logs</h4>
      <div className="p-3 overflow-y-auto h-32">
        {logs.map((log, i) => (
          <p key={i} className="whitespace-pre-wrap break-all">{log}</p>
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
};
