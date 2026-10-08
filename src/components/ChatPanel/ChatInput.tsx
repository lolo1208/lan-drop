/**
 * 聊天输入区域组件
 * 提供多行文本输入、回车发送、表情选择弹窗、附件选择与文件拖拽释放处理
 */

import React, { RefObject } from "react";
import { Smile, Paperclip, Send, ScanLine, X } from "lucide-react";
import { ScreenshotDraft } from "../../hooks/useScreenshot";

interface ChatInputProps {
  screenshotDrafts: ScreenshotDraft[];
  onScreenshot: () => Promise<void>;
  screenshotSupported: boolean;
  isCapturing: boolean;
  screenshotHotkey: string;
  isSending: boolean;
  onRemoveScreenshot: (id: string) => void;
  onPreviewScreenshot: (draft: ScreenshotDraft) => void;
  inputText: string;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  showEmojiPicker: boolean;
  setShowEmojiPicker: React.Dispatch<React.SetStateAction<boolean>>;
  recentEmojis: string[];
  commonEmojis: string[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  emojiPickerRef: RefObject<HTMLDivElement | null>;
  handleSend: (e?: React.FormEvent) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handlePaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  handleFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleSelectEmoji: (emoji: string) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  screenshotDrafts,
  onScreenshot,
  screenshotSupported,
  isCapturing,
  screenshotHotkey,
  isSending,
  onRemoveScreenshot,
  onPreviewScreenshot,
  inputText,
  setInputText,
  showEmojiPicker,
  setShowEmojiPicker,
  recentEmojis,
  commonEmojis,
  textareaRef,
  fileInputRef,
  emojiPickerRef,
  handleSend,
  handleKeyDown,
  handlePaste,
  handleFileInputChange,
  handleSelectEmoji,
}) => {
  return (
    <div className="border-t border-[#2b2b2b] bg-[#181818] p-3 flex flex-col shrink-0 relative">
      <input
        ref={fileInputRef as any}
        type="file"
        multiple
        onChange={handleFileInputChange}
        className="hidden"
      />

      {showEmojiPicker && (
        <div
          ref={emojiPickerRef as any}
          className="absolute bottom-12 left-3 z-50 w-72 sm:w-80 bg-[#252526] border border-[#3c3c3c] rounded-2xl shadow-2xl p-3 animate-in fade-in zoom-in-95 duration-150 text-[#cccccc]"
        >
          {recentEmojis.length > 0 && (
            <div className="mb-2.5 pb-2.5 border-b border-[#333333]">
              <div className="text-[11px] font-semibold text-[#cccccc] mb-1.5 px-0.5 flex items-center justify-between">
                <span>最近使用</span>
                <span className="text-[10px] text-[#858585] font-normal">
                  点击直接插入
                </span>
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

          <div>
            <div className="text-[11px] font-semibold text-[#cccccc] mb-1.5 px-0.5 flex items-center justify-between">
              <span>所有表情</span>
              {recentEmojis.length === 0 && (
                <span className="text-[10px] text-[#858585] font-normal">
                  点击直接插入
                </span>
              )}
            </div>
            <div className="grid grid-cols-8 gap-1 max-h-44 overflow-y-auto custom-scrollbar p-0.5">
              {commonEmojis.map((emoji, index) => (
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

      <div className="rounded-lg bg-[#252526] border border-[#3c3c3c] focus-within:border-[#0078d4] transition-colors p-1.5">
        {screenshotDrafts.length > 0 && (
          <div className="flex gap-2 overflow-x-auto p-2" aria-label="待发送截图">
            {screenshotDrafts.map((draft) => (
              <div key={draft.id} className="relative shrink-0">
                <button type="button" onClick={() => onPreviewScreenshot(draft)}
                  className="block rounded-md overflow-hidden border border-[#3c3c3c] focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
                  title={`预览截图（${draft.width} × ${draft.height}）`}>
                  <img src={draft.previewUrl} alt={`待发送截图，${draft.width} × ${draft.height} 像素`}
                    className="w-24 h-16 object-contain bg-[#181818]" />
                </button>
                <button type="button" onClick={() => onRemoveScreenshot(draft.id)} disabled={isSending}
                  className="absolute -top-1 -right-1 p-1 rounded-full bg-[#333333] text-white hover:bg-red-600 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
                  aria-label="移除这张截图" title="移除截图">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef as any}
          rows={3}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="输入消息（Enter 发送，Shift + Enter 换行），或直接拖拽文件/截图粘贴至此处发送"
          className="w-full bg-transparent text-xs sm:text-sm text-[#cccccc] placeholder-[#6e7681] focus:outline-none resize-none px-2 py-1 max-h-32 overflow-y-auto custom-scrollbar"
        />
      </div>

      <div className="flex items-center justify-between pt-2 px-0.5 mt-0.5 h-8 shrink-0">
        <div className="flex items-center space-x-1 sm:space-x-1.5 h-full">
          <button type="button" onClick={() => void onScreenshot()}
            disabled={!screenshotSupported || isCapturing}
            className="h-7 px-2.5 rounded-lg border border-transparent box-border text-[#9d9d9d] hover:text-[#cccccc] hover:bg-[#2a2d2e] transition-colors flex items-center gap-1.5 text-xs font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[#38bdf8]"
            title={!screenshotSupported ? "截图功能目前仅支持 Windows 桌面客户端" : isCapturing ? "正在截图" : `屏幕截图${screenshotHotkey ? `（${screenshotHotkey}）` : "（全局热键已禁用）"}`}>
            <ScanLine className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />
            <span>{isCapturing ? "截图中" : "截图"}</span>
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="h-7 px-2.5 rounded-lg border border-transparent box-border text-[#858585] hover:text-[#cccccc] hover:bg-[#2a2d2e] transition-colors flex items-center gap-1.5 text-xs font-medium cursor-pointer"
            title="选择并发送文件或多媒体"
          >
            <Paperclip className="w-3.5 h-3.5 text-[#38bdf8] shrink-0" />
            <span>文件</span>
          </button>
          <button
            type="button"
            onClick={() => setShowEmojiPicker((prev) => !prev)}
            className={`h-7 px-2.5 rounded-lg border box-border transition-colors flex items-center gap-1.5 text-xs font-medium cursor-pointer ${
              showEmojiPicker
                ? "bg-[#094771] text-white border-[#0078d4]"
                : "text-[#858585] hover:text-[#cccccc] hover:bg-[#2a2d2e] border-transparent"
            }`}
            title="常用表情"
          >
            <Smile className="w-3.5 h-3.5 text-[#cca700] shrink-0" />
            <span>表情</span>
          </button>

        </div>

        <button
          id="chat-send-msg-btn"
          onClick={() => handleSend()}
          disabled={isSending || (!inputText.trim() && screenshotDrafts.length === 0)}
          className="h-7 px-3.5 rounded-lg bg-[#0078d4] hover:bg-[#0284c7] active:bg-[#006cc1] disabled:opacity-40 disabled:hover:bg-[#0078d4] text-white font-medium text-xs flex items-center justify-center gap-1.5 transition-all shadow-xs shrink-0 active:scale-95 cursor-pointer"
          title="发送消息 (Enter)"
        >
          <span>{isSending ? "发送中" : "发送"}</span>
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
