/**
 * 用户头像预设与图片工具
 * 提供 11 个本地 SVG 系统头像与相关解析/压缩函数
 */

export interface PresetAvatar {
  id: string; // '0', '1', ..., '10'
  name: string; // 展示名称
  url: string; // '/avatar/0.svg', '/avatar/1.svg', ...
}

// 预设 11 个系统矢量头像，位于 public/avatar/0.svg ~ 10.svg
export const PRESET_AVATARS: PresetAvatar[] = [
  { id: '0', name: '潮酷兽', url: '/avatar/0.svg' },
  { id: '1', name: '星际客', url: '/avatar/1.svg' },
  { id: '2', name: '小萌喵', url: '/avatar/2.svg' },
  { id: '3', name: '赛博狐', url: '/avatar/3.svg' },
  { id: '4', name: '企鹅仔', url: '/avatar/4.svg' },
  { id: '5', name: '小恐龙', url: '/avatar/5.svg' },
  { id: '6', name: '暖暖熊', url: '/avatar/6.svg' },
  { id: '7', name: '黑客客', url: '/avatar/7.svg' },
  { id: '8', name: '幻彩星', url: '/avatar/8.svg' },
  { id: '9', name: '小火箭', url: '/avatar/9.svg' },
  { id: '10', name: '律动音', url: '/avatar/10.svg' },
];

/**
 * 随机获取一个系统头像 ID (0 ~ 10)
 */
export function getRandomAvatarId(): string {
  const randomIndex = Math.floor(Math.random() * PRESET_AVATARS.length);
  return String(randomIndex);
}

/**
 * 将任意格式的头像标识（ID '0'~'10' / 'avatar:0' / '/avatar/0.svg' / Base64）解析为页面 <img> 标签能直接使用的 URL
 */
export function resolveAvatarUrl(avatarStr?: string, fallbackId?: string): string {
  if (!avatarStr || avatarStr.trim() === '') {
    const id = fallbackId ?? '0';
    return `/avatar/${id}.svg`;
  }
  const str = avatarStr.trim();

  // 1. 纯数字 ID ('0' ~ '10')
  if (/^\d+$/.test(str)) {
    const num = parseInt(str, 10);
    if (num >= 0 && num <= 10) {
      return `/avatar/${num}.svg`;
    }
  }

  // 2. 带前缀形如 'avatar:0' ~ 'avatar:10'
  if (str.startsWith('avatar:')) {
    const id = str.replace('avatar:', '');
    if (/^\d+$/.test(id)) {
      return `/avatar/${id}.svg`;
    }
  }

  // 3. 已经是 /avatar/x.svg
  if (str.startsWith('/avatar/') || str.startsWith('avatar/')) {
    return str.startsWith('/') ? str : `/${str}`;
  }

  // 4. 其他情况（例如自定义上传的 base64 或外部网络 URL）直接原样返回
  return str;
}

/**
 * 提取简化头像传输标识（系统头像只传输 '0' ~ '10'，如果是 Base64 则保留原样）
 */
export function toCompactAvatarIdentifier(avatarStr?: string): string {
  if (!avatarStr || avatarStr.trim() === '') return getRandomAvatarId();
  const str = avatarStr.trim();

  // 若已经是纯数字 ID
  if (/^\d+$/.test(str)) {
    const num = parseInt(str, 10);
    if (num >= 0 && num <= 10) return String(num);
  }

  // 若形如 avatar:X
  if (str.startsWith('avatar:')) {
    const id = str.replace('avatar:', '');
    if (/^\d+$/.test(id)) return id;
  }

  // 若是 /avatar/X.svg
  const match = str.match(/\/avatar\/(\d+)\.svg/);
  if (match && match[1]) {
    return match[1];
  }

  // 匹配 PRESET_AVATARS URL 或 ID
  const preset = PRESET_AVATARS.find((a) => a.url === str || a.id === str);
  if (preset) {
    return preset.id;
  }

  // 自定义上传的 Base64 等保持原样
  return str;
}

/**
 * 判断当前头像标识是否属于系统预设头像
 */
export function isPresetAvatar(avatarStr?: string): boolean {
  if (!avatarStr) return false;
  const str = avatarStr.trim();
  if (/^\d+$/.test(str)) {
    const num = parseInt(str, 10);
    return num >= 0 && num <= 10;
  }
  if (str.startsWith('avatar:')) return true;
  if (str.startsWith('/avatar/') || str.startsWith('avatar/')) return true;
  return PRESET_AVATARS.some((a) => a.url === str || a.id === str);
}

/**
 * 将用户选择的本地图片压缩为高性价比的头像 DataURL (用于局域网广播分发)
 */
export async function processAvatarImageFile(file: File, maxSize = 128): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取本地图片失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('解析本地图片失败'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(reader.result as string);
          return;
        }

        // 居中正方形裁剪缩放
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;

        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
