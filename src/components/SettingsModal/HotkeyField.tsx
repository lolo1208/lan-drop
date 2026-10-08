/** 两项全局热键使用统一的录制与禁用交互。 */
import { Keyboard } from "lucide-react";

export function HotkeyField({ label, value, defaultValue, description, recording, disabled, onChange, onRecord }: {
  label: string;
  value: string;
  defaultValue: string;
  description: string;
  recording: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  onRecord: () => void;
}) {
  return (
    <div className="bg-[#252526]/60 border border-[#333333] rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Keyboard className="w-4 h-4 text-[#38bdf8]" />
          <span className="font-semibold text-[#e0e0e0] text-sm">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onChange(defaultValue)} disabled={disabled}
            className="text-[11px] text-[#38bdf8] hover:text-[#7dd3fc] disabled:opacity-40">
            默认 ({defaultValue})
          </button>
          {value && <button type="button" onClick={() => onChange("")} disabled={disabled}
            className="text-[11px] text-[#9d9d9d] hover:text-rose-400 disabled:opacity-40">禁用</button>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`录制${label}`} aria-pressed={recording}
          onClick={onRecord} disabled={disabled}
          className={`flex-1 min-w-0 px-3.5 py-2 border rounded-lg text-left text-xs font-mono font-semibold transition-colors disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[#38bdf8] ${recording ? "bg-[#1a2e3b] border-[#0078d4] text-[#38bdf8]" : "bg-[#1e1e1e] border-[#3c3c3c] text-[#cccccc]"}`}>
          {recording ? "请按快捷键组合（Esc 取消）" : value || "未设置（已禁用）"}
        </button>
        <button type="button" onClick={onRecord} disabled={disabled}
          className="px-3.5 py-2 rounded-lg text-xs font-medium bg-[#2d2d2d] hover:bg-[#383838] text-[#cccccc] disabled:opacity-40">
          {recording ? "取消" : "更改快捷键"}
        </button>
      </div>
      <p className="text-[11px] text-[#9d9d9d] mt-1.5 leading-relaxed">{description}</p>
    </div>
  );
}
