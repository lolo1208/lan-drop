/**
 * 聊天与文件传输主面板容器组件
 * 整合联系人顶部状态栏、消息历史滚动列表、表情选择面板以及底部输入与附件拖拽发送区域
 */

import { CheckSquare, Radio, Trash2, UploadCloud, X } from "lucide-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChatMessage, PeerDevice } from "../../types";
import { DynamicTipsBanner } from "../DynamicTipsBanner";
import { ConfirmModal } from "../ConfirmModal";
import { ChatHeader } from "./ChatHeader";
import { ChatInput } from "./ChatInput";
import { MessageList } from "./MessageList";

// prettier-ignore
const COMMON_EMOJIS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
  '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😋', '😛', '😜',
  '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞',
  '😔', '😟', '😕', '🙁', '😣', '😖', '😫', '😩', '🥺', '😢',
  '😭', '😤', '😠', '😡', '🤯', '😳', '🥵', '🥶', '😱', '😨',
  '🤔', '🤗', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄',
  '👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉',
  '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤝', '👏',
  '🙌', '👐', '🤲', '🙏', '💪', '❤️', '🧡', '💛', '💚', '💙',
  '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗',
  '💖', '💘', '💝', '🎉', '🎊', '✨', '🔥', '💯', '🌟', '⭐',
  '☕', '🍻', '🍰', '🍕', '🍔', '🚀', '🎁', '🎈', '💻', '📱',
];

interface ChatPanelProps {
  peer: PeerDevice | null;
  messages: ChatMessage[];
  currentUserId?: string;
  currentUserIp?: string;
  currentUserAvatarUrl?: string;
  highlightMessageId?: string | null;
  onSendMessage: (peer: PeerDevice, text: string) => void;
  onSendFile: (
    peer: PeerDevice,
    file: File | { name: string; size: number; type: string; blob: Blob },
  ) => void;
  onAcceptFile: (msg: ChatMessage) => void;
  onResumeFile?: (msg: ChatMessage) => void;
  onDeleteMessage?: (msg: ChatMessage) => void;
  onDeleteMessages?: (msgs: ChatMessage[]) => void;
  onClearChat?: (peerId: string) => void;
  onOpenInFolder: (
    savedPath?: string,
    fileName?: string,
    isMedia?: boolean,
  ) => void;
  onPreviewMedia: (
    type: "image" | "video" | "audio",
    url: string,
    fileName: string,
    filePath?: string,
  ) => void;
  onMarkPeerRead?: (peerId: string) => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  peer,
  messages,
  currentUserId,
  currentUserIp,
  highlightMessageId,
  onSendMessage,
  onSendFile,
  onAcceptFile,
  onResumeFile,
  onDeleteMessage,
  onDeleteMessages,
  onClearChat,
  onOpenInFolder,
  onPreviewMedia,
  onMarkPeerRead,
}) => {
  const [inputText, setInputText] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(
    new Set(),
  );
  const [isBatchDeleteModalOpen, setIsBatchDeleteModalOpen] = useState(false);

  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("flashdrop_recent_emojis");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.slice(0, 8);
      }
    } catch {
      // ignore
    }
    return [];
  });

  const dragCounterRef = useRef(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const [unreadNewCount, setUnreadNewCount] = useState(0);

  const isAtBottomRef = useRef<boolean>(true);
  const prevPeerIdRef = useRef<string | null>(null);
  const lastKnownMsgIdRef = useRef<string | null>(null);

  // 切换联系人时重置多选状态
  useEffect(() => {
    setIsSelectionMode(false);
    setSelectedMessageIds(new Set());
  }, [peer?.id]);

  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? "smooth" : "auto",
    });
    setShowScrollBottomBtn(false);
    setUnreadNewCount(0);
    isAtBottomRef.current = true;
  };

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceToBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const isAtBottomNow = distanceToBottom <= 80;

    isAtBottomRef.current = isAtBottomNow;

    if (isAtBottomNow) {
      setShowScrollBottomBtn(false);
      setUnreadNewCount(0);
    } else {
      setShowScrollBottomBtn(true);
    }
  };

  const visibleMessages = useMemo(() => {
    return messages.filter((m) => {
      if (!m) return false;
      if (m.msgType === "system") return false;
      if (m.content && m.content.startsWith("file_accept:")) return false;
      if (!m.fileAttachment && (!m.content || !m.content.trim())) return false;
      return true;
    });
  }, [messages]);

  // 多选操作方法
  const handleToggleSelectMessage = useCallback((msgId: string) => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) {
        next.delete(msgId);
      } else {
        next.add(msgId);
      }
      return next;
    });
  }, []);

  const handleEnterSelectMode = useCallback((msgId: string) => {
    setIsSelectionMode(true);
    setSelectedMessageIds(new Set([msgId]));
  }, []);

  const handleToggleSelectAll = () => {
    if (selectedMessageIds.size === visibleMessages.length) {
      setSelectedMessageIds(new Set());
    } else {
      setSelectedMessageIds(new Set(visibleMessages.map((m) => m.id)));
    }
  };

  const handleExecuteBatchDelete = () => {
    if (selectedMessageIds.size === 0) return;
    const targets = visibleMessages.filter((m) =>
      selectedMessageIds.has(m.id),
    );
    onDeleteMessages?.(targets);
    setIsSelectionMode(false);
    setSelectedMessageIds(new Set());
  };

  useEffect(() => {
    if (peer && peer.id) {
      if (peer.id !== prevPeerIdRef.current) {
        prevPeerIdRef.current = peer.id;
        lastKnownMsgIdRef.current =
          visibleMessages[visibleMessages.length - 1]?.id || null;
        scrollToBottom(false);
      }
      onMarkPeerRead?.(peer.id);
    }
  }, [peer?.id]);

  useEffect(() => {
    if (highlightMessageId) {
      const timer = setTimeout(() => {
        const el = document.getElementById(`msg-${highlightMessageId}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 150);
      return () => clearTimeout(timer);
    }

    if (visibleMessages.length === 0) return;

    const latestMsg = visibleMessages[visibleMessages.length - 1];

    if (latestMsg && latestMsg.id !== lastKnownMsgIdRef.current) {
      lastKnownMsgIdRef.current = latestMsg.id;

      const isMe =
        (currentUserId && latestMsg.senderId === currentUserId) ||
        (currentUserIp &&
          currentUserIp !== "" &&
          latestMsg.senderIp === currentUserIp);

      if (isAtBottomRef.current || isMe) {
        scrollToBottom(true);
        if (peer?.id) {
          onMarkPeerRead?.(peer.id);
        }
      } else {
        setUnreadNewCount((prev) => prev + 1);
        setShowScrollBottomBtn(true);
      }
    }
  }, [
    visibleMessages,
    highlightMessageId,
    currentUserId,
    currentUserIp,
    peer?.id,
  ]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        emojiPickerRef.current &&
        !emojiPickerRef.current.contains(e.target as Node)
      ) {
        setShowEmojiPicker(false);
      }
    };

    if (showEmojiPicker) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showEmojiPicker]);

  const recentSentMapRef = useRef<Map<string, number>>(new Map());

  const triggerSendFile = useCallback(
    (
      targetPeer: PeerDevice,
      file: File | { name: string; size?: number; path?: string },
    ) => {
      if (!targetPeer || !file) return;

      const fileName = file.name || "file";
      const fileSize = file.size || 0;
      const filePath = (file as any).path || "";
      const fileKey = `${targetPeer.id}_${fileName}_${fileSize}_${filePath}`;
      const now = Date.now();

      const lastSentTime = recentSentMapRef.current.get(fileKey) || 0;
      if (now - lastSentTime < 1500) {
        console.log("防重复：已拦截短时间内重复触发的文件发送:", fileName);
        return;
      }

      recentSentMapRef.current.set(fileKey, now);

      for (const [k, time] of recentSentMapRef.current.entries()) {
        if (now - time > 10000) {
          recentSentMapRef.current.delete(k);
        }
      }

      onSendFile(targetPeer, file as File);
    },
    [onSendFile],
  );

  useEffect(() => {
    if (!peer) return;

    const unlisteners: (() => void)[] = [];
    const setupTauriDropListener = async () => {
      if (typeof window === "undefined") return;
      const isTauriEnv =
        "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
      if (!isTauriEnv) return;

      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const un = await getCurrentWindow().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") {
            setIsDragging(true);
          } else if (
            payload.type === "leave" ||
            (payload as any).type === "cancel"
          ) {
            setIsDragging(false);
            dragCounterRef.current = 0;
          } else if (payload.type === "drop") {
            setIsDragging(false);
            dragCounterRef.current = 0;
            const paths: string[] = payload.paths || [];
            if (paths && paths.length > 0) {
              paths.forEach((filePath) => {
                const fileName = filePath.split(/[/\\]/).pop() || "file";
                triggerSendFile(peer, {
                  name: fileName,
                  size: 0,
                  type: "application/octet-stream",
                  blob: new Blob([]),
                  path: filePath,
                } as any);
              });
            }
          }
        });
        unlisteners.push(un);
      } catch (err) {
        console.log("Tauri onDragDropEvent fallback to listen:", err);
      }

      try {
        const { listen } = await import("@tauri-apps/api/event");
        const events = [
          "tauri://drop",
          "tauri://file-drop",
          "tauri://drag-drop",
        ];
        for (const evtName of events) {
          const un = await listen<any>(evtName, (event) => {
            setIsDragging(false);
            dragCounterRef.current = 0;
            const payload = event.payload;
            const paths: string[] = Array.isArray(payload)
              ? payload
              : payload?.paths || [];

            if (paths && paths.length > 0) {
              paths.forEach((filePath) => {
                const fileName = filePath.split(/[/\\]/).pop() || "file";
                triggerSendFile(peer, {
                  name: fileName,
                  size: 0,
                  type: "application/octet-stream",
                  blob: new Blob([]),
                  path: filePath,
                } as any);
              });
            }
          });
          unlisteners.push(un);
        }
      } catch (err) {
        console.log("Tauri listen failed:", err);
      }
    };

    setupTauriDropListener();

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [peer, triggerSendFile]);

  if (!peer) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center bg-[#1e1e1e] text-[#858585] p-6 sm:p-8 select-none">
        <Radio className="w-14 h-14 text-[#0078d4] mb-2" />
        <h3 className="text-base font-semibold text-[#e0e0e0]">
          未选择聊天对象
        </h3>
        <p className="text-xs text-[#858585] mt-1 mb-6 max-w-sm text-center">
          在左侧列表中选择联系人，即可发送文本、拖拽文件或直接在线预览图片与音视频
        </p>
        <DynamicTipsBanner />
      </div>
    );
  }

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(peer, inputText.trim());
    setInputText("");
    setShowEmojiPicker(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSelectEmoji = (emoji: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setInputText((prev) => prev + emoji);
    } else {
      const start = textarea.selectionStart ?? inputText.length;
      const end = textarea.selectionEnd ?? inputText.length;
      const newText = inputText.slice(0, start) + emoji + inputText.slice(end);
      setInputText(newText);

      requestAnimationFrame(() => {
        textarea.focus();
        const newPos = start + emoji.length;
        textarea.setSelectionRange(newPos, newPos);
      });
    }

    setRecentEmojis((prev) => {
      const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, 8);
      try {
        localStorage.setItem("flashdrop_recent_emojis", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });

    setShowEmojiPicker(false);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer && e.dataTransfer.types) {
      const types = Array.from(e.dataTransfer.types).map((t) =>
        t.toLowerCase(),
      );
      const hasFiles =
        types.length === 0 ||
        types.includes("files") ||
        types.includes("application/x-moz-file") ||
        types.includes("public.file-url") ||
        types.includes("text/uri-list") ||
        types.some((t) => t.includes("file"));

      if (!hasFiles) return;
    }

    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) {
      setIsDragging(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
    if (!isDragging) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    if (!peer) return;

    const filesToSend: File[] = [];

    if (
      e.dataTransfer &&
      e.dataTransfer.files &&
      e.dataTransfer.files.length > 0
    ) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files.item(i);
        if (file) filesToSend.push(file);
      }
    }

    if (
      filesToSend.length === 0 &&
      e.dataTransfer &&
      e.dataTransfer.items &&
      e.dataTransfer.items.length > 0
    ) {
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i];
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) filesToSend.push(file);
        }
      }
    }

    if (filesToSend.length > 0) {
      filesToSend.forEach((f) => triggerSendFile(peer, f));
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!peer) return;
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;

    const filesToSend: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) filesToSend.push(file);
      }
    }

    if (filesToSend.length > 0) {
      e.preventDefault();
      filesToSend.forEach((f) => triggerSendFile(peer, f));
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && peer) {
      Array.from(e.target.files).forEach((f) => {
        triggerSendFile(peer, f);
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div
      className="flex-1 h-full flex flex-col bg-[#1e1e1e] relative select-text"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-0 z-50 pointer-events-none bg-[#094771]/90 backdrop-blur-xs border-2 border-dashed border-[#38bdf8] flex flex-col items-center justify-center text-white cursor-copy animate-in fade-in select-none">
          <UploadCloud className="w-16 h-16 text-[#38bdf8] mb-3 animate-bounce" />
          <h4 className="text-base sm:text-lg font-bold text-[#f0f9ff]">
            松开鼠标直接投送文件给 {peer.name}
          </h4>
          <p className="text-xs text-[#9cdcfe] mt-1.5 max-w-md text-center px-4">
            拖动至消息列表或输入区域均可触发直接发送，文件将通过局域网流式传输
          </p>
        </div>
      )}

      <ChatHeader
        peer={peer}
        messageCount={visibleMessages.length}
        isSelectionMode={isSelectionMode}
        onToggleSelectionMode={() => {
          setIsSelectionMode(!isSelectionMode);
          setSelectedMessageIds(new Set());
        }}
        onClearChat={() => {
          if (peer) onClearChat?.(peer.id);
        }}
      />

      <MessageList
        peer={peer}
        visibleMessages={visibleMessages}
        currentUserId={currentUserId}
        currentUserIp={currentUserIp}
        highlightMessageId={highlightMessageId}
        showScrollBottomBtn={showScrollBottomBtn}
        unreadNewCount={unreadNewCount}
        isSelectionMode={isSelectionMode}
        selectedMessageIds={selectedMessageIds}
        onToggleSelect={handleToggleSelectMessage}
        onEnterSelectMode={handleEnterSelectMode}
        onDeleteMessage={onDeleteMessage}
        scrollContainerRef={scrollContainerRef}
        messagesEndRef={messagesEndRef}
        handleScroll={handleScroll}
        scrollToBottom={scrollToBottom}
        onAcceptFile={onAcceptFile}
        onResumeFile={onResumeFile}
        onOpenInFolder={onOpenInFolder}
        onPreviewMedia={onPreviewMedia}
      />

      {/* 多选模式底部操作栏 */}
      {isSelectionMode ? (
        <div className="p-3 bg-[#252526] border-t border-[#3c3c3c] flex items-center justify-between z-30 animate-in slide-in-from-bottom duration-150">
          <div className="flex items-center space-x-3">
            <button
              onClick={handleToggleSelectAll}
              className="px-3 py-1.5 rounded-xl text-xs font-medium bg-[#2d2d2d] hover:bg-[#383838] text-[#cccccc] border border-[#3c3c3c] flex items-center space-x-2 transition-all cursor-pointer select-none"
            >
              <div
                className={`w-4 h-4 rounded-md flex items-center justify-center transition-all border ${
                  selectedMessageIds.size === visibleMessages.length && visibleMessages.length > 0
                    ? "bg-[#0078d4] border-[#0078d4] text-white"
                    : "bg-[#202020] border-[#444444] text-transparent"
                }`}
              >
                <CheckSquare className="w-3 h-3" />
              </div>
              <span>
                {selectedMessageIds.size === visibleMessages.length &&
                visibleMessages.length > 0
                  ? "取消全选"
                  : "全选"}
              </span>
            </button>
            <span className="text-xs text-[#858585]">
              已选中{" "}
              <strong className="text-[#38bdf8] font-bold font-mono">
                {selectedMessageIds.size}
              </strong>{" "}
              / {visibleMessages.length} 条消息
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                setIsSelectionMode(false);
                setSelectedMessageIds(new Set());
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#2d2d2d] hover:bg-[#383838] text-[#858585] hover:text-[#cccccc] transition-colors"
            >
              取消
            </button>
            <button
              disabled={selectedMessageIds.size === 0}
              onClick={() => setIsBatchDeleteModalOpen(true)}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 active:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white shadow-sm flex items-center space-x-1.5 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>批量删除 ({selectedMessageIds.size})</span>
            </button>
          </div>
        </div>
      ) : (
        <ChatInput
          inputText={inputText}
          setInputText={setInputText}
          showEmojiPicker={showEmojiPicker}
          setShowEmojiPicker={setShowEmojiPicker}
          recentEmojis={recentEmojis}
          commonEmojis={COMMON_EMOJIS}
          textareaRef={textareaRef}
          fileInputRef={fileInputRef}
          emojiPickerRef={emojiPickerRef}
          handleSend={handleSend}
          handleKeyDown={handleKeyDown}
          handlePaste={handlePaste}
          handleFileInputChange={handleFileInputChange}
          handleSelectEmoji={handleSelectEmoji}
        />
      )}

      {/* 批量删除确认模态框 */}
      <ConfirmModal
        isOpen={isBatchDeleteModalOpen}
        title="批量删除所选聊天记录"
        description={`确定删除选中的 ${selectedMessageIds.size} 条聊天记录吗？\n\n如果选中的记录包含文件、图片或音视频，对应文件也将一并从磁盘中永久物理删除。`}
        confirmText="确认批量删除"
        cancelText="取消"
        isDanger={true}
        onConfirm={handleExecuteBatchDelete}
        onClose={() => setIsBatchDeleteModalOpen(false)}
      />
    </div>
  );
};
