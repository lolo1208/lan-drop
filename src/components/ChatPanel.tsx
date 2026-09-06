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

import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Paperclip,
  Radio,
  Send,
  Smile,
  UploadCloud,
} from 'lucide-react';
import { ChatMessage, PeerDevice } from '../types';
import { MessageBubble } from './MessageBubble';
import { DynamicTipsBanner } from './DynamicTipsBanner';

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
  highlightMessageId?: string | null;
  onSendMessage: (peer: PeerDevice, text: string) => void;
  onSendFile: (peer: PeerDevice, file: File | { name: string; size: number; type: string; blob: Blob }) => void;
  onAcceptFile: (msg: ChatMessage) => void;
  onOpenInFolder: (savedPath?: string, fileName?: string) => void;
  onPreviewMedia: (type: 'image' | 'video', url: string, fileName: string) => void;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  peer,
  messages,
  highlightMessageId,
  onSendMessage,
  onSendFile,
  onAcceptFile,
  onOpenInFolder,
  onPreviewMedia,
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  // 消息吸底或定位到指定搜索到的消息
  useEffect(() => {
    if (highlightMessageId) {
      const timer = setTimeout(() => {
        const el = document.getElementById(`msg-${highlightMessageId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 150);
      return () => clearTimeout(timer);
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, highlightMessageId]);

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

  // 拖拽文件进入聊天框
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      Array.from(e.dataTransfer.files).forEach((f) => {
        onSendFile(peer, f);
      });
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      Array.from(e.target.files).forEach((f) => {
        onSendFile(peer, f);
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div
      className="flex-1 h-full flex flex-col bg-[#1e1e1e] relative select-text"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 拖拽全屏高亮遮罩 (VS Code 选区科技蓝风格) */}
      {isDragging && (
        <div className="absolute inset-0 z-40 bg-[#094771]/90 backdrop-blur-xs border-2 border-dashed border-[#0078d4] flex flex-col items-center justify-center text-white pointer-events-none animate-in fade-in">
          <UploadCloud className="w-14 h-14 text-[#38bdf8] mb-2 animate-bounce" />
          <h4 className="text-base font-bold">释放鼠标将文件推入聊天</h4>
          <p className="text-xs text-[#9cdcfe] mt-1">
            将生成一条文件消息，接收方点击接收后即时写入磁盘
          </p>
        </div>
      )}

      {/* 顶部标题栏：纯粹展示用户信息 (高度与左侧完全对齐为 h-16) */}
      <div className="h-16 px-5 border-b border-[#2b2b2b] bg-[#181818] flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl overflow-hidden bg-[#252526] border border-[#3c3c3c] flex items-center justify-center text-xs font-bold text-[#cccccc] shrink-0">
            {peer.avatarUrl ? (
              <img
                src={peer.avatarUrl}
                alt={peer.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span>{peer.name.slice(0, 2).toUpperCase()}</span>
            )}
          </div>

          <div>
            <div className="text-sm font-bold text-[#e0e0e0] leading-tight">
              {peer.name}
            </div>
            <div className="text-[11px] font-mono text-[#858585] leading-tight mt-0.5">
              {peer.ip}
            </div>
          </div>
        </div>
      </div>

      {/* 聊天记录主列表 */}
      <div className="flex-1 p-4 sm:p-5 overflow-y-auto custom-scrollbar bg-[#1e1e1e]">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4">
            <Radio className="w-8 h-8 text-[#4f4f4f] mb-3 animate-pulse" />
            <div className="mb-3 text-xs text-[#858585]">
              与 <span className="text-[#e0e0e0] font-medium">{peer.name}</span> 暂无聊天记录
            </div>
            {/* 动态安全与使用提示 */}
            <DynamicTipsBanner variant="compact" />
          </div>
        ) : (
          messages.map((msg, index) => (
            <MessageBubble
              key={`${msg.id}-${index}`}
              message={msg}
              isMe={msg.senderId !== peer.id}
              peer={peer}
              isHighlighted={msg.id === highlightMessageId}
              onAcceptFile={onAcceptFile}
              onOpenInFolder={onOpenInFolder}
              onPreviewMedia={onPreviewMedia}
            />
          ))
        )}
        <div ref={messagesEndRef} />
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
            placeholder="输入消息（Enter 发送，Shift + Enter 换行），也可直接拖拽文件发送"
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
