/**
 * LAN Drop 聊天与投送面板 - VS Code 2026 深色 (Dark Modern) 主题
 * 包含：
 * 1. 顶部用户名称与IP (VS Code 标题栏风格)
 * 2. 聊天记录滚动区（支持搜索定位与高亮）
 * 3. 拖拽推流上传 (VS Code 选区蓝半透明覆盖)
 * 4. 底部聊天输入区：
 *    - 文本输入框在上
 *    - 下方同一行放置：表情按钮、发送文件按钮、VS Code 标志性科技蓝发送按钮
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ChevronDown,
  Paperclip,
  Radio,
  Send,
  Smile,
  UploadCloud,
} from 'lucide-react';
import { ChatMessage, PeerDevice } from '../types';
import { MessageBubble } from './MessageBubble';
import { DynamicTipsBanner } from './DynamicTipsBanner';
import { resolveAvatarUrl } from '../utils/avatars';

// 常用 Emoji 表情精选列表
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
  onSendFile: (peer: PeerDevice, file: File | { name: string; size: number; type: string; blob: Blob }) => void;
  onAcceptFile: (msg: ChatMessage) => void;
  onResumeFile?: (msg: ChatMessage) => void;
  onOpenInFolder: (savedPath?: string, fileName?: string, isMedia?: boolean) => void;
  onPreviewMedia: (type: 'image' | 'video' | 'audio', url: string, fileName: string, filePath?: string) => void;
  onMarkPeerRead?: (peerId: string) => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  peer,
  messages,
  currentUserId,
  currentUserIp,
  currentUserAvatarUrl: _currentUserAvatarUrl,
  highlightMessageId,
  onSendMessage,
  onSendFile,
  onAcceptFile,
  onResumeFile,
  onOpenInFolder,
  onPreviewMedia,
  onMarkPeerRead,
}) => {
  const [inputText, setInputText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('flashdrop_recent_emojis');
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

  // 一键平滑定位到底部
  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
    setShowScrollBottomBtn(false);
    setUnreadNewCount(0);
    isAtBottomRef.current = true;
  };

  // 监听聊天框手动滚动：距离底部 > 80px 时判定为查看历史消息状态，并悬浮“回到底部”或“新消息提示”按钮
  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isAtBottomNow = distanceToBottom <= 80;

    isAtBottomRef.current = isAtBottomNow;

    if (isAtBottomNow) {
      setShowScrollBottomBtn(false);
      setUnreadNewCount(0);
    } else {
      setShowScrollBottomBtn(true);
    }
  };

  // 过滤展示型消息（彻底排除 system 信令与无附件无内容的空消息）
  const visibleMessages = useMemo(() => {
    return messages.filter((m) => {
      if (!m) return false;
      if (m.msgType === 'system') return false;
      if (m.content && m.content.startsWith('file_accept:')) return false;
      if (!m.fileAttachment && (!m.content || !m.content.trim())) return false;
      return true;
    });
  }, [messages]);

  // 1. 切换聊天对象（peer.id 变动）时：重置状态、标为已读并强制滚到底部
  useEffect(() => {
    if (peer && peer.id) {
      if (peer.id !== prevPeerIdRef.current) {
        prevPeerIdRef.current = peer.id;
        lastKnownMsgIdRef.current = visibleMessages[visibleMessages.length - 1]?.id || null;
        scrollToBottom(false);
      }
      // 触发将该联系人的消息批量标记为已读
      onMarkPeerRead?.(peer.id);
    }
  }, [peer?.id]);

  // 2. 收到新消息或历史检索定位时的智能滚动处理：
  //    - 查看历史消息（!isAtBottomRef.current）时，收到对方新消息绝不自动强行滚动到底部
  //    - 只有处于底端（isAtBottomRef.current）或是我发出的新消息时，才会自动滚动到底部
  useEffect(() => {
    if (highlightMessageId) {
      const timer = setTimeout(() => {
        const el = document.getElementById(`msg-${highlightMessageId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
        (currentUserIp && currentUserIp !== '' && latestMsg.senderIp === currentUserIp);

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
  }, [visibleMessages, highlightMessageId, currentUserId, currentUserIp, peer?.id]);

  // 点击表情选择器外部自动关闭
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
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showEmojiPicker]);

  // 记录近期已发送文件的特征标识与时间戳，防止 DOM drop 与 Tauri 原生事件并发重复发送同一个文件
  const recentSentMapRef = useRef<Map<string, number>>(new Map());

  const triggerSendFile = useCallback((targetPeer: PeerDevice, file: File | { name: string; size?: number; path?: string }) => {
    if (!targetPeer || !file) return;

    const fileName = file.name || 'file';
    const fileSize = file.size || 0;
    const filePath = (file as any).path || '';
    const fileKey = `${targetPeer.id}_${fileName}_${fileSize}_${filePath}`;
    const now = Date.now();

    // 1500 毫秒内相同联系人+相同文件的重复请求直接拦截
    const lastSentTime = recentSentMapRef.current.get(fileKey) || 0;
    if (now - lastSentTime < 1500) {
      console.log('防重复：已拦截短时间内重复触发的文件发送:', fileName);
      return;
    }

    recentSentMapRef.current.set(fileKey, now);

    // 定期清理 10 秒前的旧记录
    for (const [k, time] of recentSentMapRef.current.entries()) {
      if (now - time > 10000) {
        recentSentMapRef.current.delete(k);
      }
    }

    onSendFile(targetPeer, file as File);
  }, [onSendFile]);

  // 监听 Tauri 原生桌面端拖放文件事件 (如直接从 Windows 资源管理器/Mac Finder 拖入窗口)
  useEffect(() => {
    if (!peer) return;

    const unlisteners: (() => void)[] = [];
    const setupTauriDropListener = async () => {
      if (typeof window === 'undefined') return;
      const isTauriEnv = '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
      if (!isTauriEnv) return;

      // 1. Tauri v2 官方 Window Drag & Drop 原生事件监听
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const un = await getCurrentWindow().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === 'enter' || payload.type === 'over') {
            setIsDragging(true);
          } else if (payload.type === 'leave' || (payload as any).type === 'cancel') {
            setIsDragging(false);
            dragCounterRef.current = 0;
          } else if (payload.type === 'drop') {
            setIsDragging(false);
            dragCounterRef.current = 0;
            const paths: string[] = payload.paths || [];
            if (paths && paths.length > 0) {
              paths.forEach((filePath) => {
                const fileName = filePath.split(/[/\\]/).pop() || 'file';
                triggerSendFile(peer, {
                  name: fileName,
                  size: 0,
                  type: 'application/octet-stream',
                  blob: new Blob([]),
                  path: filePath,
                } as any);
              });
            }
          }
        });
        unlisteners.push(un);
      } catch (err) {
        console.log('Tauri onDragDropEvent fallback to listen:', err);
      }

      // 2. 兼容 Tauri 全系列事件总线 (tauri://drop, tauri://file-drop, tauri://drag-drop)
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const events = ['tauri://drop', 'tauri://file-drop', 'tauri://drag-drop'];
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
                const fileName = filePath.split(/[/\\]/).pop() || 'file';
                triggerSendFile(peer, {
                  name: fileName,
                  size: 0,
                  type: 'application/octet-stream',
                  blob: new Blob([]),
                  path: filePath,
                } as any);
              });
            }
          });
          unlisteners.push(un);
        }
      } catch (err) {
        console.log('Tauri listen failed:', err);
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
        <div className="w-16 h-16 rounded-2xl bg-[#252526] flex items-center justify-center text-[#858585] mb-3.5 border border-[#3c3c3c] shadow-lg">
          <Activity className="w-8 h-8 text-[#0078d4]" />
        </div>
        <h3 className="text-base font-semibold text-[#e0e0e0]">未选择聊天对象</h3>
        <p className="text-xs text-[#858585] mt-1 mb-6 max-w-sm text-center">
          在左侧列表中选择联系人，即可发送文本、拖拽文件或直接在线预览图片与音视频
        </p>

        {/* 动态安全与使用提示卡片 */}
        <DynamicTipsBanner variant="card" />
      </div>
    );
  }

  const handleSend = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(peer, inputText.trim());
    setInputText('');
    setShowEmojiPicker(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 点击选择表情并插入到输入框光标所在位置，并自动记录最近使用，随后自动关闭弹层
  const handleSelectEmoji = (emoji: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setInputText((prev) => prev + emoji);
    } else {
      const start = textarea.selectionStart ?? inputText.length;
      const end = textarea.selectionEnd ?? inputText.length;
      const newText = inputText.slice(0, start) + emoji + inputText.slice(end);
      setInputText(newText);

      // 重新让输入框聚焦并定位光标到插入的表情之后
      requestAnimationFrame(() => {
        textarea.focus();
        const newPos = start + emoji.length;
        textarea.setSelectionRange(newPos, newPos);
      });
    }

    // 记录到“最近使用”（去重并排在首位，最多保留8个，即一行）
    setRecentEmojis((prev) => {
      const next = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, 8);
      try {
        localStorage.setItem('flashdrop_recent_emojis', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });

    // 用户要求：点击某个表情时，自动关闭表情列表界面
    setShowEmojiPicker(false);
  };

  // 拖拽文件进入聊天消息列表或输入框区域
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // 校验是否包含文件类型数据（大小写不敏感且兼容各类浏览器/系统）
    if (e.dataTransfer && e.dataTransfer.types) {
      const types = Array.from(e.dataTransfer.types).map((t) => t.toLowerCase());
      const hasFiles =
        types.length === 0 ||
        types.includes('files') ||
        types.includes('application/x-moz-file') ||
        types.includes('public.file-url') ||
        types.includes('text/uri-list') ||
        types.some((t) => t.includes('file'));

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
      e.dataTransfer.dropEffect = 'copy';
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

    // 1. 优先提取 HTML5 拖放的 FileList
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files.item(i);
        if (file) filesToSend.push(file);
      }
    }

    // 2. 备用提取 e.dataTransfer.items
    if (filesToSend.length === 0 && e.dataTransfer && e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i];
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) filesToSend.push(file);
        }
      }
    }

    if (filesToSend.length > 0) {
      filesToSend.forEach((f) => triggerSendFile(peer, f));
    }
  };

  // 支持在输入框 Ctrl+V 直接粘贴剪贴板中的文件或截图发送
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!peer) return;
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;

    const filesToSend: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
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
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div
      className="flex-1 h-full flex flex-col bg-[#1e1e1e] relative select-text"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 拖拽全屏高亮遮罩 (VS Code 选区科技蓝风格，精准贴合消息列表与输入框) */}
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

      {/* 顶部标题栏：展示对端用户信息与在线/离线实时状态 (高度与左侧对齐为 h-16) */}
      <div className="h-16 px-5 border-b border-[#2b2b2b] bg-[#181818] flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          {/* 头像与在线状态指示点 */}
          <div className="relative">
            <div
              className={`w-9 h-9 rounded-xl overflow-hidden bg-[#252526] border border-[#3c3c3c] flex items-center justify-center text-xs font-bold text-[#cccccc] shrink-0 transition-all ${
                peer.status === 'offline' ? 'opacity-70 grayscale-[30%]' : 'opacity-100'
              }`}
            >
              {peer.avatarUrl ? (
                <img
                  src={resolveAvatarUrl(peer.avatarUrl)}
                  alt={peer.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span>{peer.name.slice(0, 2).toUpperCase()}</span>
              )}
            </div>
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#181818] ${
                peer.status === 'online'
                  ? 'bg-[#10b981] ring-1 ring-[#10b981]/40'
                  : 'bg-[#6e7681]'
              }`}
              title={peer.status === 'online' ? '当前在线' : '当前离线'}
            />
          </div>

          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-bold text-[#e0e0e0] leading-tight">
                {peer.name}
              </span>
              <span
                className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  peer.status === 'online'
                    ? 'text-[#10b981] bg-[#10b981]/10 border border-[#10b981]/25'
                    : 'text-[#858585] bg-[#252526] border border-[#3c3c3c]'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full mr-1 ${
                    peer.status === 'online' ? 'bg-[#10b981]' : 'bg-[#858585]'
                  }`}
                />
                {peer.status === 'online' ? '在线' : '离线'}
              </span>
            </div>
            <div className="text-[11px] font-mono text-[#858585] leading-tight mt-0.5">
              {peer.ip || '局域网设备'}
            </div>
          </div>
        </div>

        {peer.status === 'offline' && (
          <div className="text-[11px] text-[#858585] bg-[#252526] px-2.5 py-1 rounded-lg border border-[#333333] hidden sm:flex items-center space-x-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#6e7681]" />
            <span>对方已离线，新消息将在对方重新上线后同步</span>
          </div>
        )}
      </div>

      {/* 聊天记录主容器 */}
      <div className="flex-1 relative flex flex-col min-h-0 overflow-hidden bg-[#1e1e1e]">
        {/* 当不在底部时在视口下方中央浮现的“回到底部 / 收到新消息”悬浮控制按钮 */}
        {showScrollBottomBtn && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 animate-in fade-in zoom-in-95 duration-200">
            <button
              onClick={() => scrollToBottom(true)}
              className={`px-4 py-2 rounded-full text-xs font-bold shadow-2xl flex items-center gap-2 transition-all cursor-pointer border active:scale-95 ${
                unreadNewCount > 0
                  ? 'bg-[#0078d4] hover:bg-[#0284c7] active:bg-[#006cc1] text-white border-[#38bdf8]/50 ring-2 ring-[#0078d4]/30 animate-bounce'
                  : 'bg-[#252526]/90 hover:bg-[#2a2d2e] text-[#cccccc] hover:text-white border-[#3c3c3c] backdrop-blur-md'
              }`}
              title="点击跳转至最新消息"
            >
              <ChevronDown className={`w-4 h-4 ${unreadNewCount > 0 ? 'text-white' : 'text-[#38bdf8]'}`} />
              <span>
                {unreadNewCount > 0 ? `收到 ${unreadNewCount} 条新消息` : '回到底部'}
              </span>
            </button>
          </div>
        )}

        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 p-4 sm:p-5 overflow-y-auto custom-scrollbar bg-[#1e1e1e]"
        >

        {visibleMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4">
            <Radio className="w-8 h-8 text-[#4f4f4f] mb-3 animate-pulse" />
            <div className="mb-3 text-xs text-[#858585]">
              与 <span className="text-[#e0e0e0] font-medium">{peer.name}</span> 暂无聊天记录
            </div>
            {/* 动态安全与使用提示 */}
            <DynamicTipsBanner variant="compact" />
          </div>
        ) : (
          visibleMessages.map((msg, index) => {
            // 核心判定：消息发送方 ID 等于当前设备 ID 或发送方 IP 等于当前设备 IP，则为“我发出的消息”（居右）
            // 否则为“对端发来的消息”（居左）
            const isMe =
              (currentUserId && msg.senderId === currentUserId) ||
              (currentUserIp && currentUserIp !== '' && msg.senderIp === currentUserIp);

            return (
              <MessageBubble
                key={`${msg.id}-${index}`}
                message={msg}
                isMe={!!isMe}
                peer={peer}
                isHighlighted={msg.id === highlightMessageId}
                onAcceptFile={onAcceptFile}
                onResumeFile={onResumeFile}
                onOpenInFolder={onOpenInFolder}
                onPreviewMedia={onPreviewMedia}
              />
            );
          })
        )}
        <div ref={messagesEndRef} />
        </div>
      </div>

      {/* 底部聊天输入区：输入框在上，下方同一行放置 [表情] [发送文件] 以及右侧缩小的 [发送] 按钮 */}
      <div className="border-t border-[#2b2b2b] bg-[#181818] p-3 flex flex-col shrink-0 relative">
        {/* 隐藏文件输入控件 */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileInputChange}
          className="hidden"
        />

        {/* Emoji 表情选择浮层 */}
        {showEmojiPicker && (
          <div
            ref={emojiPickerRef}
            className="absolute bottom-12 left-3 z-50 w-72 sm:w-80 bg-[#252526] border border-[#3c3c3c] rounded-2xl shadow-2xl p-3 animate-in fade-in zoom-in-95 duration-150 text-[#cccccc]"
          >
            {/* 1. 最近使用分组（仅在有使用过表情后出现，最多显示8个即一行） */}
            {recentEmojis.length > 0 && (
              <div className="mb-2.5 pb-2.5 border-b border-[#333333]">
                <div className="text-[11px] font-semibold text-[#cccccc] mb-1.5 px-0.5 flex items-center justify-between">
                  <span>最近使用</span>
                  <span className="text-[10px] text-[#858585] font-normal">点击直接插入</span>
                </div>
                <div className="grid grid-cols-8 gap-1 p-0.5">
                  {recentEmojis.slice(0, 8).map((emoji, index) => (
                    <button
                      key={`recent-${index}`}
                      type="button"
                      onClick={() => handleSelectEmoji(emoji)}
                      className="w-8 h-8 rounded-lg hover:bg-[#2a2d2e] text-lg flex items-center justify-center transition-colors active:scale-110 select-none"
                      title={emoji}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 2. 所有表情分组 */}
            <div>
              <div className="text-[11px] font-semibold text-[#cccccc] mb-1.5 px-0.5 flex items-center justify-between">
                <span>所有表情</span>
                {recentEmojis.length === 0 && (
                  <span className="text-[10px] text-[#858585] font-normal">点击直接插入</span>
                )}
              </div>
              <div className="grid grid-cols-8 gap-1 max-h-44 overflow-y-auto custom-scrollbar p-0.5">
                {COMMON_EMOJIS.map((emoji, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => handleSelectEmoji(emoji)}
                    className="w-8 h-8 rounded-lg hover:bg-[#2a2d2e] text-lg flex items-center justify-center transition-colors active:scale-110 select-none"
                    title={emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 聊天输入框容器 (VS Code 编辑框风格) */}
        <div className="rounded-lg bg-[#252526] border border-[#3c3c3c] focus-within:border-[#0078d4] transition-colors p-1.5">
          <textarea
            ref={textareaRef}
            rows={3}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="输入消息（Enter 发送，Shift + Enter 换行），或直接拖拽文件/截图粘贴至此处发送"
            className="w-full bg-transparent text-xs sm:text-sm text-[#cccccc] placeholder-[#6e7681] focus:outline-none resize-none px-2 py-1 max-h-32 overflow-y-auto custom-scrollbar"
          />
        </div>

        {/* 底部同一行操作栏：表情按钮、文件按钮，以及缩小的发送按钮 */}
        <div className="flex items-center justify-between pt-2 px-0.5 mt-0.5 h-8 shrink-0">
          {/* 左侧：表情按钮 + 文件按钮 */}
          <div className="flex items-center space-x-1 sm:space-x-1.5 h-full">
            {/* 表情按钮 */}
            <button
              type="button"
              onClick={() => setShowEmojiPicker((prev) => !prev)}
              className={`h-7 px-2.5 rounded-lg border box-border transition-colors flex items-center gap-1.5 text-xs font-medium cursor-pointer ${
                showEmojiPicker
                  ? 'bg-[#094771] text-white border-[#0078d4]'
                  : 'text-[#858585] hover:text-[#cccccc] hover:bg-[#2a2d2e] border-transparent'
              }`}
              title="常用表情"
            >
              <Smile className="w-3.5 h-3.5 text-[#cca700] shrink-0" />
              <span>表情</span>
            </button>

            {/* 文件按钮 */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-7 px-2.5 rounded-lg border border-transparent box-border text-[#858585] hover:text-[#cccccc] hover:bg-[#2a2d2e] transition-colors flex items-center gap-1.5 text-xs font-medium cursor-pointer"
              title="选择并发送文件或多媒体"
            >
              <Paperclip className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />
              <span>文件</span>
            </button>
          </div>

          {/* 右侧：缩小的发送按钮 (VS Code 标志性科技蓝按钮) */}
          <button
            id="chat-send-msg-btn"
            onClick={() => handleSend()}
            disabled={!inputText.trim()}
            className="h-7 px-3.5 rounded-lg bg-[#0078d4] hover:bg-[#0284c7] active:bg-[#006cc1] disabled:opacity-40 disabled:hover:bg-[#0078d4] text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-all shadow-xs shrink-0 active:scale-95 cursor-pointer"
            title="发送消息 (Enter)"
          >
            <span>发送</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
