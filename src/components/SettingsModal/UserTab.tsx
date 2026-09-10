/**
 * 设置模态窗 - 用户个人信息设置面板
 * 负责修改本机设备昵称、选择系统预设或自定义头像
 */

import { Camera, Contact, Image as ImageIcon, User } from "lucide-react";
import React from "react";
import { getDefaultMachineName } from "../../services/storage";
import { LocalDeviceConfig } from "../../types";
import {
  PRESET_AVATARS,
  resolveAvatarUrl,
  toCompactAvatarIdentifier,
} from "../../utils/avatars";

interface UserTabProps {
  formData: LocalDeviceConfig;
  setFormData: React.Dispatch<React.SetStateAction<LocalDeviceConfig>>;
  imageError: string | null;
  setImageError: React.Dispatch<React.SetStateAction<string | null>>;
  sysInfo: any;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

export const UserTab: React.FC<UserTabProps> = ({
  formData,
  setFormData,
  imageError,
  setImageError,
  sysInfo,
  handleFileChange,
  fileInputRef,
}) => {
  return (
    <>
      <div className="space-y-5 animate-in fade-in duration-150">
        {/* 用户头像设置 */}
        <div className="bg-[#252526]/60 border border-[#333333] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-[#38bdf8]" />
              <span className="font-semibold text-[#e0e0e0] text-sm">
                用户头像
              </span>
            </div>
            <span className="text-[11px] text-[#858585]">
              选择系统头像或本地图片
            </span>
          </div>

          <div className="flex items-start gap-4">
            {/* 当前头像大图预览 + 上传入口 */}
            <div
              onClick={() => fileInputRef.current?.click()}
              className="w-18 h-18 rounded-2xl overflow-hidden ring-2 ring-[#0078d4] bg-[#1e1e1e] relative group shrink-0 cursor-pointer flex items-center justify-center shadow-md transition-all hover:scale-102"
              title="点击更换为本地图片"
            >
              {formData.avatarUrl ? (
                <img
                  src={resolveAvatarUrl(formData.avatarUrl)}
                  alt="用户头像"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-2xl font-bold text-white">
                  {formData.name
                    ? formData.name.slice(0, 1).toUpperCase()
                    : "U"}
                </span>
              )}
              <div className="absolute inset-0 bg-black/65 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white text-[10px]">
                <Camera className="w-4 h-4 mb-0.5" />
                <span>更换</span>
              </div>
            </div>

            {/* 预设头像网格 */}
            <div className="flex-1 min-w-0">
              <div className="grid grid-cols-6 gap-2 items-center">
                {PRESET_AVATARS.map((avatar) => {
                  const isSelected =
                    toCompactAvatarIdentifier(formData.avatarUrl) === avatar.id;
                  return (
                    <button
                      key={avatar.id}
                      type="button"
                      onClick={() =>
                        setFormData({ ...formData, avatarUrl: avatar.id })
                      }
                      className={`w-9 h-9 rounded-xl overflow-hidden border-2 transition-all p-0.5 flex items-center justify-center bg-[#1e1e1e] cursor-pointer ${
                        isSelected
                          ? "border-[#0078d4] ring-2 ring-[#0078d4]/40 scale-105 opacity-100"
                          : "border-transparent hover:border-[#3c3c3c] opacity-60 hover:opacity-100"
                      }`}
                      title={avatar.name}
                    >
                      <img
                        src={avatar.url}
                        alt={avatar.name}
                        className="w-full h-full object-cover rounded-lg"
                      />
                    </button>
                  );
                })}

                {/* 本地图片上传按钮 */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-9 h-9 rounded-xl border border-dashed border-[#444444] hover:border-[#0078d4] hover:bg-[#2a2d2e] text-[#858585] hover:text-white flex flex-col items-center justify-center transition-all group cursor-pointer"
                  title="选择本地图片文件"
                >
                  <ImageIcon className="w-4 h-4 text-[#858585] group-hover:text-[#38bdf8] transition-colors" />
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />

              {imageError && (
                <p className="text-[10px] text-rose-400 mt-2 font-medium">
                  {imageError}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 用户名称设置 */}
        <div className="bg-[#252526]/60 border border-[#333333] rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Contact className="w-4 h-4 text-[#38bdf8]" />
              <label className="font-semibold text-[#e0e0e0] text-sm">
                用户名称
              </label>
            </div>
            <button
              type="button"
              onClick={() =>
                setFormData({
                  ...formData,
                  name: sysInfo?.hostname || getDefaultMachineName(),
                })
              }
              className="text-[11px] text-[#38bdf8] hover:text-[#7dd3fc] font-medium transition-colors cursor-pointer"
            >
              重置为机器名
            </button>
          </div>
          <input
            type="text"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder={sysInfo?.hostname || getDefaultMachineName()}
            className="w-full px-3.5 py-2.5 bg-[#1e1e1e] border border-[#3c3c3c] focus:border-[#0078d4] rounded-xl text-[#cccccc] placeholder-[#6e7681] focus:outline-none transition-colors text-xs sm:text-sm font-medium"
          />
          <p className="text-[11px] text-[#858585] mt-1.5">
            内网中用于标识本机的显示名称
          </p>
        </div>
      </div>
    </>
  );
};
