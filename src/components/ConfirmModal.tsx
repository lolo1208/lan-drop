/**
 * 通用删除与清空二次确认模态对话框
 * 具有深色沉浸式微质感、警告色按钮、快捷键支持及平滑淡入动效
 */

import React, { useEffect } from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  description,
  confirmText = "确认删除",
  cancelText = "取消",
  isDanger = true,
  onConfirm,
  onClose,
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onConfirm, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150 select-none">
      <div
        className="w-full max-w-md bg-[#252526] border border-[#3c3c3c] rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题与关闭按钮 */}
        <div className="px-5 py-4 flex items-center justify-between border-b border-[#333333]">
          <div className="flex items-center space-x-2.5">
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                isDanger
                  ? "bg-red-500/15 text-red-400 border border-red-500/30"
                  : "bg-[#0078d4]/15 text-[#38bdf8] border border-[#0078d4]/30"
              }`}
            >
              {isDanger ? (
                <Trash2 className="w-4 h-4" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )}
            </div>
            <h3 className="text-sm font-semibold text-[#f0f0f0]">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#858585] hover:text-[#cccccc] hover:bg-[#333333] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容说明 */}
        <div className="px-5 py-4">
          <p className="text-xs text-[#a0a0a0] leading-relaxed whitespace-pre-wrap">
            {description}
          </p>
        </div>

        {/* 底部按钮区 */}
        <div className="px-5 py-3.5 bg-[#1f1f1f] border-t border-[#333333] flex items-center justify-end space-x-2.5">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-[#cccccc] bg-[#2d2d2d] hover:bg-[#383838] border border-[#3c3c3c] transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`px-4 py-1.5 rounded-xl text-xs font-semibold text-white transition-all shadow-sm flex items-center space-x-1.5 ${
              isDanger
                ? "bg-red-600 hover:bg-red-500 active:bg-red-700"
                : "bg-[#0078d4] hover:bg-[#106ebe] active:bg-[#005a9e]"
            }`}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{confirmText}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
