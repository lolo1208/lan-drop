/**
 * 用户头像预设与图片工具
 * 提供现代简约、细腻高颜值的精致矢量头像与本地头像压缩函数
 */

// 预设高颜值 SVG 风格头像 (Base64/Data URI)，色彩高级丰富、离线秒开
export const PRESET_AVATARS = [
  {
    id: 'avatar-shiba',
    name: '柴犬阿黄',
    url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="shibaBg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%23f59e0b"/><stop offset="100%" stop-color="%23d97706"/></linearGradient></defs><rect width="100" height="100" rx="26" fill="url(%23shibaBg)"/><path d="M26 34l8-14 12 10zM74 34l-8-14-12 10z" fill="%23b45309"/><ellipse cx="50" cy="56" rx="28" ry="24" fill="%23fef3c7"/><ellipse cx="50" cy="62" rx="16" ry="13" fill="%23ffffff"/><circle cx="38" cy="52" r="3.5" fill="%23451a03"/><circle cx="62" cy="52" r="3.5" fill="%23451a03"/><ellipse cx="50" cy="60" rx="4.5" ry="3.5" fill="%23451a03"/><path d="M46 66q4 3 8 0" stroke="%2378350f" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="31" cy="58" r="3" fill="%23fca5a5" opacity="0.6"/><circle cx="69" cy="58" r="3" fill="%23fca5a5" opacity="0.6"/></svg>',
  },
  {
    id: 'avatar-astro',
    name: '深空宇航员',
    url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="astroBg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%231e1b4b"/><stop offset="100%" stop-color="%23312e81"/></linearGradient><linearGradient id="visor" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%2338bdf8"/><stop offset="100%" stop-color="%230284c7"/></linearGradient></defs><rect width="100" height="100" rx="26" fill="url(%23astroBg)"/><circle cx="24" cy="22" r="1.5" fill="%23ffffff" opacity="0.7"/><circle cx="78" cy="28" r="1.2" fill="%23ffffff" opacity="0.6"/><circle cx="50" cy="46" r="24" fill="%23f1f5f9"/><rect x="30" y="36" width="40" height="22" rx="11" fill="url(%23visor)"/><path d="M36 40q14-3 28 0" stroke="%23ffffff" stroke-width="2.5" stroke-linecap="round" opacity="0.7" fill="none"/><path d="M28 78c0-12 10-20 22-20s22 8 22 20" fill="%23e2e8f0"/><circle cx="50" cy="72" r="4" fill="%2338bdf8"/></svg>',
  },
  {
    id: 'avatar-cat',
    name: '墨镜潮猫',
    url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="catBg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%230d9488"/><stop offset="100%" stop-color="%23115e59"/></linearGradient></defs><rect width="100" height="100" rx="26" fill="url(%23catBg)"/><polygon points="26,38 34,18 46,30" fill="%23f8fafc"/><polygon points="30,34 35,22 42,30" fill="%23fda4af"/><polygon points="74,38 66,18 54,30" fill="%23f8fafc"/><polygon points="70,34 65,22 58,30" fill="%23fda4af"/><circle cx="50" cy="54" r="26" fill="%23f8fafc"/><rect x="28" y="44" width="44" height="16" rx="8" fill="%230f172a"/><circle cx="38" cy="52" r="6" fill="%23334155"/><circle cx="62" cy="52" r="6" fill="%23334155"/><ellipse cx="50" cy="65" rx="3" ry="2" fill="%23f43f5e"/><path d="M46 68q4 2 8 0" stroke="%2364748b" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
  },
  {
    id: 'avatar-fox',
    name: '赛博灵狐',
    url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="foxBg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%23ec4899"/><stop offset="100%" stop-color="%238b5cf6"/></linearGradient></defs><rect width="100" height="100" rx="26" fill="url(%23foxBg)"/><polygon points="24,40 28,14 50,34" fill="%23ffffff"/><polygon points="76,40 72,14 50,34" fill="%23ffffff"/><polygon points="30,36 33,22 46,33" fill="%23f43f5e"/><polygon points="70,36 67,22 54,33" fill="%23f43f5e"/><polygon points="26,42 74,42 50,78" fill="%23ffffff"/><polygon points="38,42 62,42 50,60" fill="%23cbd5e1"/><ellipse cx="38" cy="46" rx="3.5" ry="2.5" fill="%230f172a"/><ellipse cx="62" cy="46" rx="3.5" ry="2.5" fill="%230f172a"/><circle cx="50" cy="74" r="4" fill="%230f172a"/></svg>',
  },
  {
    id: 'avatar-penguin',
    name: '萌趣企鹅',
    url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="penBg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%230284c7"/><stop offset="100%" stop-color="%230369a1"/></linearGradient></defs><rect width="100" height="100" rx="26" fill="url(%23penBg)"/><ellipse cx="50" cy="54" rx="25" ry="28" fill="%230f172a"/><ellipse cx="50" cy="58" rx="18" ry="22" fill="%23ffffff"/><circle cx="41" cy="46" r="3" fill="%230f172a"/><circle cx="59" cy="46" r="3" fill="%230f172a"/><circle cx="42" cy="45" r="1" fill="%23ffffff"/><circle cx="60" cy="45" r="1" fill="%23ffffff"/><polygon points="46,52 54,52 50,60" fill="%23f59e0b"/><circle cx="34" cy="52" r="3.5" fill="%23fda4af" opacity="0.7"/><circle cx="66" cy="52" r="3.5" fill="%23fda4af" opacity="0.7"/></svg>',
  },
  {
    id: 'avatar-dino',
    name: '抹茶小恐龙',
    url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="dinoBg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%2310b981"/><stop offset="100%" stop-color="%23047857"/></linearGradient></defs><rect width="100" height="100" rx="26" fill="url(%23dinoBg)"/><circle cx="28" cy="38" r="5" fill="%23a7f3d0"/><circle cx="24" cy="50" r="5" fill="%23a7f3d0"/><circle cx="24" cy="62" r="5" fill="%23a7f3d0"/><path d="M30 68c0-20 12-36 34-36h8a6 6 0 0 1 6 6v14a12 12 0 0 1-12 12H54c-12 0-24 2-24 4z" fill="%23ecfdf5"/><circle cx="66" cy="42" r="4" fill="%23064e3b"/><circle cx="67" cy="41" r="1.5" fill="%23ffffff"/><ellipse cx="72" cy="48" rx="2" ry="1.5" fill="%23059669"/><ellipse cx="58" cy="50" rx="4" ry="2.5" fill="%23fca5a5" opacity="0.6"/></svg>',
  },
  {
    id: 'avatar-bear',
    name: '暖心熊熊',
    url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="bearBg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%23d97706"/><stop offset="100%" stop-color="%2392400e"/></linearGradient></defs><rect width="100" height="100" rx="26" fill="url(%23bearBg)"/><circle cx="30" cy="32" r="10" fill="%23b45309"/><circle cx="30" cy="32" r="6" fill="%23fde68a"/><circle cx="70" cy="32" r="10" fill="%23b45309"/><circle cx="70" cy="32" r="6" fill="%23fde68a"/><circle cx="50" cy="54" r="26" fill="%23b45309"/><ellipse cx="50" cy="62" rx="14" ry="10" fill="%23fef3c7"/><ellipse cx="50" cy="59" rx="5" ry="3.5" fill="%23451a03"/><circle cx="38" cy="48" r="3.5" fill="%23451a03"/><circle cx="62" cy="48" r="3.5" fill="%23451a03"/><path d="M47 66q3 2 6 0" stroke="%2378350f" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
  },
  {
    id: 'avatar-geek',
    name: '黑客极客',
    url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="geekBg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%23334155"/><stop offset="100%" stop-color="%230f172a"/></linearGradient></defs><rect width="100" height="100" rx="26" fill="url(%23geekBg)"/><circle cx="50" cy="42" r="20" fill="%23f1f5f9"/><rect x="34" y="36" width="14" height="11" rx="3" fill="%230284c7"/><rect x="52" y="36" width="14" height="11" rx="3" fill="%230284c7"/><line x1="48" y1="41" x2="52" y2="41" stroke="%230284c7" stroke-width="2.5"/><text x="37" y="44" fill="%23ffffff" font-size="7" font-family="monospace">&lt;/&gt;</text><path d="M26 80c2-14 12-22 24-22s22 8 24 22" fill="%2338bdf8"/></svg>',
  },
  {
    id: 'avatar-saturn',
    name: '幻境星环',
    url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="satBg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%236366f1"/><stop offset="100%" stop-color="%234338ca"/></linearGradient><linearGradient id="planet" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%23f472b6"/><stop offset="100%" stop-color="%23db2777"/></linearGradient></defs><rect width="100" height="100" rx="26" fill="url(%23satBg)"/><circle cx="26" cy="24" r="1.5" fill="%23ffffff" opacity="0.8"/><circle cx="76" cy="74" r="1.5" fill="%23ffffff" opacity="0.8"/><circle cx="50" cy="50" r="18" fill="url(%23planet)"/><ellipse cx="50" cy="50" rx="36" ry="9" stroke="%23fbbf24" stroke-width="4.5" fill="none" transform="rotate(-25 50 50)"/><path d="M36 43a18 18 0 0 0 25 15" stroke="%23fdf2f8" stroke-width="2" stroke-linecap="round" fill="none"/></svg>',
  },
  {
    id: 'avatar-rocket',
    name: '探索火箭',
    url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="rockBg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%23ef4444"/><stop offset="100%" stop-color="%23b91c1c"/></linearGradient></defs><rect width="100" height="100" rx="26" fill="url(%23rockBg)"/><polygon points="30,76 34,60 44,68" fill="%23f97316"/><polygon points="76,30 60,34 68,44" fill="%23f97316"/><ellipse cx="56" cy="44" rx="24" ry="12" fill="%23ffffff" transform="rotate(-45 56 44)"/><circle cx="58" cy="42" r="5" fill="%2338bdf8"/><path d="M32 68l-8 8m4-14l-6 6m14-4l-6 6" stroke="%23fef08a" stroke-width="3" stroke-linecap="round"/></svg>',
  },
  {
    id: 'avatar-music',
    name: '律动耳机',
    url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="musBg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%238b5cf6"/><stop offset="100%" stop-color="%236d28d9"/></linearGradient></defs><rect width="100" height="100" rx="26" fill="url(%23musBg)"/><circle cx="50" cy="48" r="16" fill="%23ede9fe"/><path d="M28 50a22 22 0 0 1 44 0" stroke="%23c4b5fd" stroke-width="4.5" fill="none"/><rect x="25" y="44" width="8" height="16" rx="4" fill="%23a78bfa"/><rect x="67" y="44" width="8" height="16" rx="4" fill="%23a78bfa"/><circle cx="44" cy="48" r="2.5" fill="%234c1d95"/><circle cx="56" cy="48" r="2.5" fill="%234c1d95"/><path d="M47 54q3 2 6 0" stroke="%236d28d9" stroke-width="1.8" stroke-linecap="round" fill="none"/><path d="M30 78c3-10 11-16 20-16s17 6 20 16" fill="%23ddd6fe"/></svg>',
  },
];

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
