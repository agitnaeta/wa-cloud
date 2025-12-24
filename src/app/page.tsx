'use client'
import { useEffect, useState, useRef, FormEvent } from 'react'
import io, { Socket } from 'socket.io-client'
import Lock from './Lock'

// --- Types ---
interface Chat {
  id: string
  name?: string
  isGroup?: boolean
}

interface Media {
  mimetype: string
  data: string // base64
  filename?: string | null
}

interface Message {
  id?: string
  body: string
  from: string
  to: string
  fromMe: boolean
  media?: Media | null
  type?: string
  hasMedia?: boolean
  location?: {
    latitude: number
    longitude: number
    description?: string
  }
}

interface MessagesMap {
  [chatId: string]: Message[]
}

interface UnreadCount {
  [chatId: string]: number
}

interface ChatsEvent {
  chatId: string
  messages: Message[]
}

let socket: Socket | null = null

const getProgressWidth = (stage: string): string => {
  switch (stage) {
    case 'Initializing...': return '20%'
    case 'Checking existing session...': return '40%'
    case 'Starting new session...': return '60%'
    case 'QR Code ready - Please scan': return '80%'
    case 'Authenticated - Loading chats...': return '90%'
    case 'Session restored - Loading chats...': return '90%'
    case 'Client ready - Loading chats...': return '95%'
    default: return '30%'
  }
}

export default function Home() {
  const [qrCode, setQrCode] = useState<string>('')
  const [isLocked, setIsLocked] = useState<boolean>(true)
  const [isReady, setIsReady] = useState<boolean>(false)
  const [loadingStage, setLoadingStage] = useState<string>('Initializing...')
  const [hasError, setHasError] = useState<boolean>(false)
  const [logs, setLogs] = useState<string[]>([])
  const [chats, setChats] = useState<Chat[]>([])
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null)
  const [messages, setMessages] = useState<MessagesMap>({})
  const [unreadCounts, setUnreadCounts] = useState<UnreadCount>({})
  
  // Timeout ref to detect stuck loading
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 🔑 ref supaya listener socket bisa tau chat terbaru
  const selectedChatRef = useRef<Chat | null>(null)
  useEffect(() => {
    selectedChatRef.current = selectedChat
  }, [selectedChat])

  const addLog = (log: string) =>
    setLogs((prevLogs) => [`[${new Date().toLocaleTimeString()}] ${log}`, ...prevLogs])

  // Function to mark chat as read
  const markChatAsRead = (chatId: string) => {
    setUnreadCounts(prev => ({
      ...prev,
      [chatId]: 0
    }))
  }

  // Function to increment unread count
  const incrementUnreadCount = (chatId: string) => {
    setUnreadCounts(prev => ({
      ...prev,
      [chatId]: (prev[chatId] || 0) + 1
    }))
  }

  // --- Socket.IO Event Listeners ---
  useEffect(() => {
    socket = io()
    
    // Set timeout for loading detection
    loadingTimeoutRef.current = setTimeout(() => {
      if (!isReady && !qrCode) {
        setHasError(true)
        setLoadingStage('Connection timeout - Check server logs')
        addLog('Loading timeout detected - server may not be responding')
      }
    }, 30000) // 30 second timeout

    socket.on('connect', () => {
      addLog('Socket connected!')
      setLoadingStage('Checking existing session...')
      socket?.emit('check-session') // minta status session
      socket?.emit('get-chats')
    })
    
    socket.on('disconnect', () => {
      addLog('Socket disconnected!')
      setLoadingStage('Connection lost - Reconnecting...')
    })
    
    socket.on('connect_error', (error) => {
      addLog(`Connection error: ${error.message}`)
      setHasError(true)
      setLoadingStage('Connection failed')
    })

    socket.on('qr', (qr: string) => {
      setQrCode(qr)
      setIsReady(false)
      setHasError(false)
      setLoadingStage('QR Code ready - Please scan')
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current)
      }
    })

    socket.on('authenticated', () => {
      setIsReady(true)
      setHasError(false)
      setLoadingStage('Authenticated - Loading chats...')
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current)
      }
    })

    socket.on('session_exists', (exists: boolean) => {
      if (exists) {
        setIsReady(true)
        setHasError(false)
        setLoadingStage('Session restored - Loading chats...')
        addLog('Session already exists, client ready!')
        socket?.emit('get-chats')
        if (loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current)
        }
      } else {
        setLoadingStage('Starting new session...')
        addLog('No active session yet, waiting for ready/authenticated...')
        // jangan setIsReady(false) di sini biar gak nutup UI
      }
    })

    socket.on('ready', () => {
      setIsReady(true)
      setHasError(false)
      setLoadingStage('Client ready - Loading chats...')
      addLog('Client is ready!')
      socket?.emit('get-chats')
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current)
      }
    })

    socket.on('log', (log: string) => addLog(log))

    socket.on('chats', (chatList: Chat[]) => {
      setChats(chatList)
      addLog(`Chat list received: ${chatList.length} chats`)
    })

    socket.on('messages', (data: ChatsEvent) =>
      setMessages((prev) => ({ ...prev, [data.chatId]: data.messages })),
    )

    // Pesan masuk dari WA
    socket.on('message', (newMessage: Message) => {
      const chatId = newMessage.fromMe ? newMessage.to : newMessage.from

      console.log(newMessage.hasMedia)
      setMessages((prev) => ({
        ...prev,
        [chatId]: [...(prev[chatId] || []), newMessage],
      }))

      // Only increment unread count for incoming messages (not from me)
      // and only if the chat is not currently selected
      if (!newMessage.fromMe && selectedChatRef.current?.id !== chatId) {
        incrementUnreadCount(chatId)
      }
    })

    // Pesan keluar yang udah dikonfirmasi server
    socket.on('message_sent', (newMessage: Message) => {
      const chatId = selectedChatRef.current?.id
      if (!chatId) return

      setMessages((prev) => ({
        ...prev,
        [chatId]: [...(prev[chatId] || []), { ...newMessage, fromMe: true }],
      }))
    })

    return () => {
      socket?.disconnect()
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current)
      }
    }
  }, [])

  // --- Fetch messages ketika ganti chat ---
  useEffect(() => {
    if (selectedChat && !messages[selectedChat.id]) {
      addLog(`Fetching messages for ${selectedChat.name || selectedChat.id}...`)
      socket?.emit('get-messages', selectedChat.id)
    }
    
    // Mark chat as read when selected
    if (selectedChat) {
      markChatAsRead(selectedChat.id)
    }
  }, [selectedChat, messages])

  if (isLocked) return <Lock setIsLocked={setIsLocked} />
  if (!isReady) return <QRCodeDisplay qrCode={qrCode} logs={logs} loadingStage={loadingStage} hasError={hasError} onRetry={() => window.location.reload()} />

  return (
    <div className="flex h-screen font-sans text-gray-800">
      {/* Left Panel: Chat List */}
      <div className={`${selectedChat ? 'hidden md:flex' : 'flex'} w-full md:w-[30%] border-r border-gray-200 flex-col bg-white`}>
        <header className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h1 className="text-xl font-semibold">Chats</h1>
          {selectedChat && (
            <button
              onClick={() => setSelectedChat(null)}
              className="md:hidden text-gray-600 hover:text-gray-800"
            >
              ✕
            </button>
          )}
        </header>
        <div className="flex-1 overflow-y-auto">
          {chats.map((chat) => (
            <ChatListItem
              key={chat.id}
              chat={chat}
              selectedChat={selectedChat}
              unreadCount={unreadCounts[chat.id] || 0}
              onSelect={setSelectedChat}
            />
          ))}
        </div>
        <div className="h-40 overflow-y-auto hidden md:block">
          <LogPanel logs={logs} />
        </div>
      </div>

      {/* Right Panel: Messages */}
      <div className={`${selectedChat ? 'flex' : 'hidden md:flex'} w-full md:w-[70%] flex-col`}>
        {selectedChat ? (
          <MessagePanel
            selectedChat={selectedChat}
            messages={messages[selectedChat.id] || []}
            setMessages={setMessages}
            addLog={addLog}
            onBack={() => setSelectedChat(null)}
          />
        ) : (
          <WelcomeScreen />
        )}
      </div>
    </div>
  )
}

// --- Sub-Components ---
const QRCodeDisplay = ({ qrCode, logs, loadingStage, hasError, onRetry }: { qrCode: string; logs: string[]; loadingStage: string; hasError: boolean; onRetry: () => void }) => (
  <div className="flex flex-col items-center justify-center h-screen bg-gray-50 p-4">
    <div className="p-6 md:p-8 bg-white rounded-lg shadow-lg text-center max-w-sm md:max-w-md w-full">
      <h2 className="text-xl md:text-2xl font-semibold mb-4 text-gray-700">Scan QR Code to Connect</h2>
      {qrCode ? (
        <img
          src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(
            qrCode,
          )}&size=250x250`}
          alt="QR Code"
          className="mx-auto w-full max-w-[250px]"
        />
      ) : hasError ? (
        <div className="flex flex-col items-center space-y-4">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
            <span className="text-red-600 text-2xl">⚠️</span>
          </div>
          <p className="text-red-600 font-medium">{loadingStage}</p>
          <div className="text-sm text-gray-600 max-w-xs">
            <p>The WhatsApp client failed to initialize. This could be due to:</p>
            <ul className="text-left mt-2 space-y-1">
              <li>• Browser/Chromium not found on server</li>
              <li>• Server configuration issues</li>
              <li>• Network connectivity problems</li>
            </ul>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <button 
              onClick={onRetry}
              className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Retry Connection
            </button>
            <button 
              onClick={() => window.open('/logs', '_blank')}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              View Logs
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center space-y-4">
          <div className="w-16 h-16 border-4 border-green-200 border-t-green-600 rounded-full animate-spin"></div>
          <p className="text-gray-600">{loadingStage}</p>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-green-600 h-2 rounded-full transition-all duration-500" 
                 style={{width: getProgressWidth(loadingStage)}}></div>
          </div>
          <p className="text-sm text-gray-500">This may take a few moments</p>
        </div>
      )}
    </div>
    <div className="w-full max-w-4xl mt-4 md:mt-8 hidden md:block">
      <LogPanel logs={logs} />
    </div>
  </div>
)

const ChatListItem = ({
  chat,
  selectedChat,
  unreadCount,
  onSelect,
}: {
  chat: Chat
  selectedChat: Chat | null
  unreadCount: number
  onSelect: (chat: Chat) => void
}) => (
  <div
    className={`flex items-center p-4 cursor-pointer hover:bg-gray-100 active:bg-gray-200 transition-colors ${
      selectedChat?.id === chat.id ? 'bg-gray-100' : ''
    }`}
    onClick={() => onSelect(chat)}
  >
    <div className="w-12 h-12 bg-gray-300 rounded-full mr-4 flex-shrink-0 flex items-center justify-center text-lg">
      {chat.isGroup ? '👥' : '👤'}
    </div>
    <div className="flex-1 overflow-hidden">
      <p className="font-semibold truncate text-base">{chat.name || chat.id.split('@')[0] || 'Unknown'}</p>
    </div>
    {unreadCount > 0 && (
      <div className="bg-green-500 text-white rounded-full min-w-[24px] h-6 flex items-center justify-center text-sm font-medium px-2 ml-2">
        {unreadCount > 99 ? '99+' : unreadCount}
      </div>
    )}
  </div>
)

const WelcomeScreen = () => (
  <div className="flex flex-col flex-1 items-center justify-center text-center bg-gray-100">
    <h3 className="text-xl text-gray-600">Select a chat to start messaging</h3>
    <p className="text-gray-400">Your conversations will appear here.</p>
  </div>
)

const MessagePanel = ({
  selectedChat,
  messages,
  setMessages,
  addLog,
  onBack,
}: {
  selectedChat: Chat
  messages: Message[]
  setMessages: React.Dispatch<React.SetStateAction<MessagesMap>>
  addLog: (log: string) => void
  onBack: () => void
}) => {
  const [message, setMessage] = useState<string>('')
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = (e: FormEvent) => {
    e.preventDefault()
    if (socket && selectedChat && message.trim()) {
      addLog(`Sending message to ${selectedChat.name || selectedChat.id}...`)

      // ✅ Optimistic update (langsung muncul hijau)
      // const tempMessage: Message = {
      //   id: `temp-${Date.now()}`,
      //   body: message,
      //   from: "me",
      //   to: selectedChat.id,
      //   fromMe: true,
      // };

      // setMessages((prev) => ({
      //   ...prev,
      //   [selectedChat.id]: [...(prev[selectedChat.id] || []), tempMessage],
      // }));

      socket.emit('send-message', { to: selectedChat.id, message })
      setMessage('')
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="p-4 border-b border-gray-200 flex items-center bg-white flex-shrink-0">
        <button
          onClick={onBack}
          className="md:hidden mr-3 p-2 text-gray-600 hover:text-gray-800"
        >
          ← Back
        </button>
        <div className="w-10 h-10 bg-gray-300 rounded-full mr-4 flex items-center justify-center">
          {selectedChat.isGroup ? '👥' : '👤'}
        </div>
        <h3 className="font-semibold truncate">{selectedChat.name || selectedChat.id}</h3>
      </header>

      <div className="flex-1 p-4 md:p-6 overflow-y-auto bg-gray-50 flex flex-col space-y-3 min-h-0">
        {messages.map((msg, index) => (
          <div
            key={msg.id || index}
            className={`max-w-[85%] md:max-w-md p-3 md:p-4 rounded-lg break-words ${
              msg.fromMe ? 'self-end bg-green-100' : 'self-start bg-white shadow-sm'
            }`}
          >
            {/* Location (prioritas) */}
            {msg.type === 'location' ? (
              <div className="flex flex-col items-start">
                {msg.hasMedia && msg.media && msg.media.mimetype.startsWith('image/') && (
                  <img
                    src={`data:${msg.media.mimetype};base64,${msg.media.data}`}
                    alt="Location thumbnail"
                    className="rounded-lg max-w-xs cursor-pointer"
                    onClick={() =>
                      window.open(
                        `https://www.google.com/maps?q=${msg.location?.latitude},${msg.location?.longitude}`,
                        '_blank',
                      )
                    }
                  />
                )}
                <a
                  href={`https://www.google.com/maps?q=${msg.location?.latitude},${msg.location?.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-green-600 underline mt-1"
                >
                  📍 {msg.location?.latitude}, {msg.location?.longitude}
                  {msg.location?.description ? ` - ${msg.location.description}` : ''}
                </a>
              </div>
            ) : msg.media ? (
              <>
                {/* Sticker */}
                {msg.type === 'sticker' && (
                  <img
                    src={`data:${msg.media.mimetype};base64,${msg.media.data}`}
                    alt="Sticker"
                    className="w-24 h-24"
                  />
                )}

                {/* Image */}
                {msg.media.mimetype.startsWith('image/') && msg.type !== 'sticker' && (
                  <img
                    src={`data:${msg.media.mimetype};base64,${msg.media.data}`}
                    alt={msg.media.filename || 'Image'}
                    className="rounded-lg max-w-full"
                  />
                )}

                {/* Video */}
                {msg.media.mimetype.startsWith('video/') && (
                  <video controls className="rounded-lg max-w-full">
                    <source
                      src={`data:${msg.media.mimetype};base64,${msg.media.data}`}
                      type={msg.media.mimetype}
                    />
                    Your browser does not support the video tag.
                  </video>
                )}

                {/* Audio / Voice Note */}
                {msg.media.mimetype.startsWith('audio/') && (
                  <audio controls>
                    <source
                      src={`data:${msg.media.mimetype};base64,${msg.media.data}`}
                      type={msg.media.mimetype}
                    />
                    Your browser does not support the audio element.
                  </audio>
                )}

                {/* Document */}
                {msg.media.mimetype.startsWith('application/') && (
                  <a
                    href={`data:${msg.media.mimetype};base64,${msg.media.data}`}
                    download={msg.media.filename || 'file'}
                    className="text-blue-600 underline"
                  >
                    📎 {msg.media.filename || 'Download file'}
                  </a>
                )}
              </>
            ) : (
              // Default = teks biasa
              msg.body
            )}
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      <form
        onSubmit={sendMessage}
        className="p-4 bg-white border-t border-gray-200 flex items-center flex-shrink-0 gap-2"
      >
        <input
          type="text"
          placeholder="Type a message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="flex-1 px-4 py-3 bg-gray-100 border border-transparent rounded-full focus:outline-none focus:ring-2 focus:ring-green-500 text-base"
        />
        <button
          type="submit"
          className="p-3 bg-green-500 text-white rounded-full hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed min-w-[48px] min-h-[48px] flex items-center justify-center"
          disabled={!message.trim()}
        >
          <span className="hidden sm:inline">Send</span>
          <span className="sm:hidden">➤</span>
        </button>
      </form>
    </div>
  )
}

const LogPanel = ({ logs }: { logs: string[] }) => {
  const logsEndRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  return (
    <div className="h-full bg-gray-800 text-green-400 font-mono text-xs">
      <h4 className="p-2 border-b border-gray-700 text-gray-400">Logs</h4>
      <div className="p-3 overflow-y-auto h-32">
        {logs.map((log, i) => (
          <p key={i} className="whitespace-pre-wrap break-all">
            {log}
          </p>
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  )
}