import json
import os

# 設定檔案路徑
VARIETIES_JSON = 'strawberry_varieties.json'
DISEASE_JSON = 'strawberry_disease.json'
OUTPUT_HTML = 'strawberry_knowledge_base.html'

def load_data(filepath):
    """讀取 JSON 檔案"""
    if not os.path.exists(filepath):
        print(f"錯誤: 找不到檔案 {filepath}")
        return {}
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"讀取 {filepath} 時發生錯誤: {e}")
        return {}

def normalize_data(data):
    """
    將不同類型的資料標準化為統一格式
    """
    normalized_items = []
    
    # 1. 處理草莓品種
    for item in data.get("草莓品種", []):
        details = []
        sugar_val = item.get("糖度", 0)
        
        if item.get("外形外觀"):
            details.append({"label": "外觀", "value": item["外形外觀"], "icon": "fa-regular fa-eye"})
        if item.get("口味口感"):
            details.append({"label": "口感", "value": item["口味口感"], "icon": "fa-solid fa-utensils"})
        
        if sugar_val > 0:
            details.insert(0, {"label": "糖度", "value": f"約 {sugar_val} 度 (Brix)", "icon": "fa-solid fa-droplet"})

        normalized_items.append({
            "id": f"var_{item['名稱']}",
            "category": "品種",
            "title": item["名稱"],
            "description": item.get("育苗簡介", "").replace('\n', '<br>'),
            "tags": item.get("tag", {}), 
            "sugar": sugar_val,
            "images": item.get("img", []),
            "details": details,
            "sources": item.get("資料來源", []),
            "icon_fallback": "fa-solid fa-seedling"
        })

    # 2. 處理病蟲害
    for item in data.get("病蟲害", []):
        details = []
        if item.get("防治方法"):
            details.append({"label": "防治重點", "value": item["防治方法"], "icon": "fa-solid fa-shield-virus"})

        icon_class = "fa-solid fa-bug" if "蟲" in item.get("tag", {}).get("類型", "") else "fa-solid fa-bacteria"

        normalized_items.append({
            "id": f"pest_{item['名稱']}",
            "category": "病蟲害",
            "title": item["名稱"],
            "description": item.get("症狀", "").replace('\n', '<br>'),
            "tags": item.get("tag", {}),
            "sugar": 0,
            "images": item.get("img", []),
            "details": details,
            "sources": item.get("資料來源", []),
            "icon_fallback": icon_class
        })

    # 3. 處理缺素
    for item in data.get("缺素", []):
        details = []
        if item.get("缺哪種元素"):
            details.append({"label": "缺乏元素", "value": item["缺哪種元素"], "icon": "fa-solid fa-flask"})

        normalized_items.append({
            "id": f"def_{item['名稱']}",
            "category": "缺素",
            "title": item["名稱"],
            "description": item.get("症狀", "").replace('\n', '<br>'),
            "tags": {"元素": item.get("缺哪種元素", "未知")},
            "sugar": 0,
            "images": item.get("img", []),
            "details": details,
            "sources": item.get("資料來源", []),
            "icon_fallback": "fa-solid fa-leaf"
        })

    return normalized_items

def generate_html(items):
    """生成包含 Alpine.js 邏輯的 HTML"""
    
    items_json = json.dumps(items, ensure_ascii=False)

    html_content = f"""<!DOCTYPE html>
<html lang="zh-TW" class="scroll-smooth">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>草莓知識百科資料庫</title>
    
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    
    <script>
        tailwind.config = {{
            darkMode: 'class',
            theme: {{
                extend: {{
                    colors: {{
                        strawberry: {{
                            50: '#fff1f2',
                            100: '#ffe4e6',
                            500: '#f43f5e',
                            600: '#e11d48',
                            700: '#be123c',
                            900: '#881337',
                        }}
                    }}
                }}
            }}
        }}
    </script>

    <style>
        [x-cloak] {{ display: none !important; }}
        .card-hover {{ transition: transform 0.3s ease, box-shadow 0.3s ease; }}
        .card-hover:hover {{ transform: translateY(-5px); box-shadow: 0 10px 20px rgba(0,0,0,0.1); }}
        ::-webkit-scrollbar {{ width: 8px; }}
        ::-webkit-scrollbar-track {{ background: transparent; }}
        ::-webkit-scrollbar-thumb {{ background: #cbd5e1; border-radius: 4px; }}
        ::-webkit-scrollbar-thumb:hover {{ background: #94a3b8; }}
        .dark ::-webkit-scrollbar-thumb {{ background: #475569; }}
        .line-clamp-3 {{
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }}
        
        /* Range Slider Styles */
        .range-slider-container {{ position: relative; width: 100%; height: 24px; }}
        .range-slider-input {{
            position: absolute; pointer-events: none; -webkit-appearance: none;
            z-index: 20; height: 24px; width: 100%; opacity: 0; cursor: pointer;
        }}
        .range-slider-input::-webkit-slider-thumb {{
            pointer-events: auto; -webkit-appearance: none; width: 20px; height: 20px;
            border-radius: 50%; background: #e11d48; cursor: pointer;
            border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.3); margin-top: 2px;
        }}
        .range-slider-input::-moz-range-thumb {{
            pointer-events: auto; width: 20px; height: 20px; border-radius: 50%;
            background: #e11d48; cursor: pointer; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }}
        .range-track-bg {{
            position: absolute; top: 50%; transform: translateY(-50%); left: 0; right: 0;
            height: 6px; background-color: #e2e8f0; border-radius: 3px; z-index: 10;
        }}
        .dark .range-track-bg {{ background-color: #475569; }}
        .range-track-fill {{
            position: absolute; top: 50%; transform: translateY(-50%);
            height: 6px; background-color: #e11d48; border-radius: 3px; z-index: 11;
        }}
        input[type=range] {{ background: transparent; }}
        input[type=range]::-webkit-slider-runnable-track {{ background: transparent; }}
        input[type=range]:focus {{ outline: none; }}
    </style>

    <script>
        function appData() {{
            return {{
                rawData: {items_json},
                searchQuery: '',
                activeCategory: 'all',
                activeTags: [],
                
                minSugar: 0,
                maxSugar: 20,
                rangeMax: 20,

                theme: 'system',
                showScrollTop: false,
                
                // --- 燈箱 (Lightbox) 狀態與邏輯 ---
                lightbox: {{
                    isOpen: false,
                    images: [],
                    currentIndex: 0
                }},
                
                openLightbox(images, index) {{
                    this.lightbox.images = images;
                    this.lightbox.currentIndex = index;
                    this.lightbox.isOpen = true;
                    document.body.style.overflow = 'hidden'; // 禁止背景捲動
                }},
                
                closeLightbox() {{
                    this.lightbox.isOpen = false;
                    document.body.style.overflow = ''; // 恢復背景捲動
                    // 延遲清空圖片以避免動畫閃爍 (可選)
                    setTimeout(() => {{ this.lightbox.images = []; }}, 300);
                }},
                
                nextLightboxImage() {{
                    if (this.lightbox.images.length <= 1) return;
                    this.lightbox.currentIndex = (this.lightbox.currentIndex + 1) % this.lightbox.images.length;
                }},
                
                prevLightboxImage() {{
                    if (this.lightbox.images.length <= 1) return;
                    this.lightbox.currentIndex = (this.lightbox.currentIndex - 1 + this.lightbox.images.length) % this.lightbox.images.length;
                }},
                // --------------------------------

                categories: [
                    {{ id: 'all', name: '全部', icon: 'fa-solid fa-layer-group' }},
                    {{ id: '品種', name: '品種圖鑑', icon: 'fa-solid fa-seedling' }},
                    {{ id: '病蟲害', name: '病蟲害防治', icon: 'fa-solid fa-shield-virus' }},
                    {{ id: '缺素', name: '營養缺素', icon: 'fa-solid fa-flask' }}
                ],

                init() {{
                    window.addEventListener('scroll', () => {{
                        this.showScrollTop = window.scrollY > 300;
                    }});
                }},
                
                // ... (篩選與其他邏輯保持不變) ...
                validateRange() {{
                    if (this.minSugar > this.maxSugar) {{
                        const temp = this.minSugar;
                        this.minSugar = this.maxSugar;
                        this.maxSugar = temp;
                    }}
                }},
                
                get minPercent() {{ return (Math.min(this.minSugar, this.maxSugar) / this.rangeMax) * 100 + '%'; }},
                get maxPercent() {{ return (Math.max(this.minSugar, this.maxSugar) / this.rangeMax) * 100 + '%'; }},
                get fillWidth() {{
                    let min = Math.min(this.minSugar, this.maxSugar);
                    let max = Math.max(this.minSugar, this.maxSugar);
                    return ((max - min) / this.rangeMax) * 100 + '%';
                }},

                get filteredItems() {{
                    if (!this.rawData) return [];
                    return this.rawData.filter(item => {{
                        const matchCat = this.activeCategory === 'all' || item.category === this.activeCategory;
                        const q = (this.searchQuery || '').toLowerCase();
                        const matchSearch = item.title.toLowerCase().includes(q) || 
                                          (item.description && item.description.toLowerCase().includes(q)) ||
                                          Object.values(item.tags).some(v => v && v.toLowerCase().includes(q));
                        let matchTags = true;
                        if (this.activeTags.length > 0) {{
                            const itemTagValues = Object.values(item.tags);
                            matchTags = this.activeTags.every(tag => itemTagValues.includes(tag));
                        }}
                        let matchSugar = true;
                        if (this.activeCategory === '品種' || this.activeCategory === 'all') {{
                            const s = item.sugar;
                            const currentMin = Math.min(this.minSugar, this.maxSugar);
                            const currentMax = Math.max(this.minSugar, this.maxSugar);
                            if (s === 0) {{ matchSugar = (currentMin === 0); }} 
                            else {{ matchSugar = s >= currentMin && s <= currentMax; }}
                        }}
                        return matchCat && matchSearch && matchTags && matchSugar;
                    }});
                }},

                get availableTags() {{
                    const tags = new Set();
                    if (this.rawData) {{
                        this.rawData.forEach(item => {{
                             if (this.activeCategory === 'all' || item.category === this.activeCategory) {{
                                 Object.values(item.tags).forEach(val => val && tags.add(val));
                             }}
                        }});
                    }}
                    return Array.from(tags).sort((a, b) => a.localeCompare(b, 'zh-TW', {{ collation: 'zhuyin' }}));
                }},

                getCount(catId) {{
                    if (!this.rawData) return 0;
                    if (catId === 'all') return this.rawData.length;
                    return this.rawData.filter(i => i.category === catId).length;
                }},

                toggleTagFilter(tag) {{
                    if (this.activeTags.includes(tag)) {{ this.activeTags = this.activeTags.filter(t => t !== tag); }} 
                    else {{ this.activeTags.push(tag); }}
                }},

                resetFilters() {{
                    this.searchQuery = '';
                    this.activeCategory = 'all';
                    this.activeTags = [];
                    this.minSugar = 0;
                    this.maxSugar = 20;
                }},

                getCategoryBadgeClass(cat) {{
                    switch(cat) {{
                        case '品種': return 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200';
                        case '病蟲害': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
                        case '缺素': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
                        default: return 'bg-gray-100 text-gray-800';
                    }}
                }},
                
                get themeIcon() {{
                    if (this.theme === 'light') return 'fa-sun';
                    if (this.theme === 'dark') return 'fa-moon';
                    return 'fa-desktop';
                }},
                initTheme() {{
                    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {{
                        document.documentElement.classList.add('dark');
                    }} else {{ document.documentElement.classList.remove('dark'); }}
                    this.theme = localStorage.theme || 'system';
                }},
                setTheme(val) {{
                    this.theme = val;
                    if (val === 'system') {{
                        localStorage.removeItem('theme');
                        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {{ document.documentElement.classList.add('dark'); }} 
                        else {{ document.documentElement.classList.remove('dark'); }}
                    }} else if (val === 'dark') {{
                        localStorage.theme = 'dark'; document.documentElement.classList.add('dark');
                    }} else {{
                        localStorage.theme = 'light'; document.documentElement.classList.remove('dark');
                    }}
                }}
            }}
        }}
    </script>
    <script src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
</head>
<body class="bg-gray-50 text-slate-900 dark:bg-black dark:text-gray-100 transition-colors duration-300 min-h-screen"
      x-data="appData()" 
      x-init="initTheme()"
      @keydown.window.escape="closeLightbox()"
      @keydown.window.arrow-right="nextLightboxImage()"
      @keydown.window.arrow-left="prevLightboxImage()">

    <nav class="sticky top-0 z-50 bg-white/90 dark:bg-black/90 backdrop-blur-md border-b border-gray-200 dark:border-gray-800 shadow-sm">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex flex-col md:flex-row justify-between items-center h-auto md:h-16 py-3 md:py-0 gap-4 md:gap-0">
                <div class="flex items-center gap-3 cursor-pointer" @click="resetFilters()">
                    <div class="bg-strawberry-100 dark:bg-strawberry-900 p-2 rounded-full">
                        <i class="fa-solid fa-book-open text-strawberry-600 dark:text-strawberry-300 text-xl"></i>
                    </div>
                    <span class="font-bold text-xl tracking-tight">
                        草莓知識<span class="text-strawberry-600">百科</span>
                    </span>
                </div>
                <div class="flex items-center gap-4 w-full md:w-auto justify-end">
                    <div class="relative w-full md:w-64">
                        <input type="text" x-model="searchQuery" placeholder="搜尋..." 
                               class="w-full pl-10 pr-4 py-2 rounded-full bg-gray-100 dark:bg-gray-800 focus:ring-2 focus:ring-strawberry-500 focus:outline-none transition-all text-sm border border-transparent focus:bg-white dark:focus:bg-gray-900 border-gray-200 dark:border-gray-700">
                        <i class="fa-solid fa-search absolute left-3 top-2.5 text-gray-400"></i>
                        <button x-show="searchQuery" @click="searchQuery = ''" class="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>
                    
                    <div class="relative" x-data="{{ open: false }}">
                        <button @click="open = !open" @click.outside="open = false" class="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800 transition">
                            <i class="fa-solid" :class="themeIcon"></i>
                        </button>
                        <div x-show="open" x-transition class="absolute right-0 mt-2 w-32 bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-100 dark:border-gray-700 py-2 text-sm z-50">
                            <button @click="setTheme('light')" class="block w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"><i class="fa-regular fa-sun text-yellow-500"></i> 亮色</button>
                            <button @click="setTheme('dark')" class="block w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"><i class="fa-regular fa-moon text-indigo-400"></i> 暗色</button>
                            <button @click="setTheme('system')" class="block w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"><i class="fa-solid fa-desktop text-gray-500"></i> 系統</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </nav>

    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div class="flex flex-wrap justify-center gap-3 mb-6 sticky top-20 md:top-20 z-40 py-2 bg-gray-50/95 dark:bg-black/95 backdrop-blur-sm">
            <template x-for="cat in categories" :key="cat.id">
                <button @click="activeCategory = cat.id"
                        :class="activeCategory === cat.id ? 'bg-strawberry-600 text-white shadow-md transform scale-105' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'"
                        class="px-5 py-2 rounded-full font-medium transition-all text-sm flex items-center gap-2">
                    <i :class="cat.icon"></i>
                    <span x-text="cat.name"></span>
                    <span class="text-xs bg-white/20 px-1.5 py-0.5 rounded-full ml-1" x-text="getCount(cat.id)"></span>
                </button>
            </template>
        </div>

        <div class="mb-8 p-4 bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800">
            <div x-show="activeCategory === 'all' || activeCategory === '品種'" class="mb-6 pb-6 border-b border-gray-100 dark:border-gray-800 px-2 md:px-8">
                <div class="flex justify-between items-center mb-6">
                    <span class="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center">
                        <i class="fa-solid fa-chart-simple mr-2 text-strawberry-500"></i>糖度篩選 (Brix)
                    </span>
                    <div class="text-xs bg-strawberry-50 dark:bg-strawberry-900/30 text-strawberry-700 dark:text-strawberry-300 px-3 py-1 rounded-full font-bold">
                        <span x-text="Math.min(minSugar, maxSugar)"></span> - <span x-text="Math.max(minSugar, maxSugar)"></span> 度
                    </div>
                </div>
                
                <div class="range-slider-container mb-2">
                    <div class="range-track-bg"></div>
                    <div class="range-track-fill" :style="'left: ' + minPercent + '; width: ' + fillWidth"></div>
                    <input type="range" min="0" max="20" step="0.5" x-model.number="minSugar" @input="validateRange()" class="range-slider-input">
                    <input type="range" min="0" max="20" step="0.5" x-model.number="maxSugar" @input="validateRange()" class="range-slider-input">
                </div>
                
                <div class="flex justify-between text-xs text-gray-400 mt-2 px-1">
                    <span>0</span><span>5</span><span>10</span><span>15</span><span>20</span>
                </div>
            </div>

            <div class="flex flex-wrap gap-2 justify-center items-center" x-show="availableTags.length > 0">
                <span class="text-sm text-gray-500 dark:text-gray-400 flex items-center mr-2"><i class="fa-solid fa-filter mr-1"></i> 特徵標籤:</span>
                <template x-for="tag in availableTags" :key="tag">
                    <button @click="toggleTagFilter(tag)"
                            :class="activeTags.includes(tag) ? 'bg-gray-700 text-white dark:bg-gray-200 dark:text-gray-900' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'"
                            class="px-3 py-1 rounded-md text-xs font-medium transition-colors border border-transparent">
                        <span x-text="tag"></span>
                    </button>
                </template>
                <button x-show="activeTags.length > 0 || minSugar > 0 || maxSugar < 20" @click="resetFilters()" class="text-xs text-red-500 hover:underline px-2 ml-2">
                    <i class="fa-solid fa-rotate-left mr-1"></i>重置
                </button>
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <template x-for="item in filteredItems" :key="item.id">
                <div class="bg-white dark:bg-gray-900 rounded-xl overflow-hidden shadow-lg border border-gray-200 dark:border-gray-700 card-hover flex flex-col h-full group">
                    
                    <div class="relative w-full h-48 bg-gray-100 dark:bg-black flex items-center justify-center overflow-hidden" 
                         x-data="{{ currentImgIdx: 0 }}">
                        <template x-if="item.images && item.images.length > 0">
                            <div class="w-full h-full relative">
                                <template x-for="(img, idx) in item.images" :key="idx">
                                    <img :src="img" 
                                         x-show="currentImgIdx === idx"
                                         x-transition:enter="transition opacity duration-300"
                                         x-transition:enter-start="opacity-0"
                                         x-transition:enter-end="opacity-100"
                                         class="w-full h-full object-cover absolute top-0 left-0 cursor-pointer hover:opacity-90 transition-opacity"
                                         @click="openLightbox(item.images, idx)" 
                                         alt="Image" title="點擊放大">
                                </template>
                                <div x-show="item.images.length > 1" class="absolute inset-0 flex justify-between items-center px-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                    <button @click.stop="currentImgIdx = (currentImgIdx - 1 + item.images.length) % item.images.length" class="pointer-events-auto bg-black/50 text-white p-2 rounded-full hover:bg-black/70 w-8 h-8 flex items-center justify-center"><i class="fa-solid fa-chevron-left text-xs"></i></button>
                                    <button @click.stop="currentImgIdx = (currentImgIdx + 1) % item.images.length" class="pointer-events-auto bg-black/50 text-white p-2 rounded-full hover:bg-black/70 w-8 h-8 flex items-center justify-center"><i class="fa-solid fa-chevron-right text-xs"></i></button>
                                </div>
                            </div>
                        </template>
                        <template x-if="!item.images || item.images.length === 0">
                            <div class="flex flex-col items-center justify-center text-gray-300 dark:text-gray-700">
                                <i :class="item.icon_fallback" class="text-6xl mb-2 opacity-50"></i>
                                <span class="text-xs">無圖片</span>
                            </div>
                        </template>
                        <div class="absolute top-3 right-3">
                             <span class="px-2 py-1 text-xs font-bold rounded shadow-sm" :class="getCategoryBadgeClass(item.category)" x-text="item.category"></span>
                        </div>
                    </div>

                    <div class="p-5 flex-1 flex flex-col">
                        <div class="flex justify-between items-start mb-3">
                            <h3 class="text-lg font-bold text-gray-900 dark:text-white leading-tight" x-text="item.title"></h3>
                        </div>

                        <div class="flex flex-wrap gap-2 mb-4">
                            <template x-for="(val, key) in item.tags" :key="key">
                                <div class="inline-flex items-center px-2.5 py-1 rounded bg-gray-100 dark:bg-gray-800 text-xs text-gray-600 dark:text-slate-200 border border-slate-300 dark:border-slate-600">
                                    <span class="opacity-70 mr-1" x-text="key + ':'"></span>
                                    <span class="font-semibold" x-text="val"></span>
                                </div>
                            </template>
                        </div>

                        <div x-data="{{ expanded: false }}" class="mb-4 relative">
                            <div class="prose dark:prose-invert text-sm text-slate-700 dark:text-slate-300 leading-relaxed transition-all duration-300"
                                 :class="(expanded || (item.description && item.description.length <= 100)) ? '' : 'line-clamp-3'"
                                 x-html="item.description"></div>
                            <button x-show="item.description && item.description.length > 100" @click="expanded = !expanded" 
                                    class="mt-1 text-xs font-bold text-strawberry-600 dark:text-strawberry-400 hover:underline flex items-center gap-1">
                                <span x-text="expanded ? '收起內容' : '閱讀更多'"></span>
                                <i class="fa-solid" :class="expanded ? 'fa-angle-up' : 'fa-angle-down'"></i>
                            </button>
                        </div>

                        <div class="mt-auto space-y-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                            <template x-for="detail in item.details" :key="detail.label">
                                <div class="flex items-start gap-3 text-sm">
                                    <div class="min-w-[20px] pt-1 text-center text-gray-400"><i :class="detail.icon"></i></div>
                                    <div>
                                        <span class="text-xs font-bold text-gray-500 dark:text-gray-500 block" x-text="detail.label"></span>
                                        <span class="text-gray-800 dark:text-gray-300" x-text="detail.value"></span>
                                    </div>
                                </div>
                            </template>
                        </div>
                        
                        <div x-show="item.sources && item.sources.length > 0" class="mt-4 pt-2">
                             <div x-data="{{ showSources: false }}">
                                <button @click="showSources = !showSources" class="text-xs text-gray-400 hover:text-strawberry-600 flex items-center gap-1 transition-colors">
                                    <i class="fa-solid fa-link"></i>參考資料來源 (<span x-text="item.sources.length"></span>)
                                </button>
                                <div x-show="showSources" x-transition class="mt-2 pl-2 border-l-2 border-strawberry-200 space-y-1">
                                    <template x-for="(source, idx) in item.sources" :key="idx">
                                        <a :href="source" target="_blank" class="block text-xs text-blue-500 hover:underline truncate w-full" x-text="source"></a>
                                    </template>
                                </div>
                             </div>
                        </div>
                    </div>
                </div>
            </template>
        </div>

        <div x-show="filteredItems.length === 0" x-cloak class="text-center py-20">
            <div class="inline-block p-6 rounded-full bg-gray-100 dark:bg-gray-800 mb-4">
                <i class="fa-solid fa-magnifying-glass text-4xl text-gray-400"></i>
            </div>
            <h3 class="text-xl font-bold text-gray-700 dark:text-gray-300 mb-2">沒有找到相關結果</h3>
            <p class="text-gray-500">請嘗試調整搜尋關鍵字或放寬篩選範圍。</p>
            <button @click="resetFilters()" class="mt-6 px-6 py-2 bg-strawberry-600 text-white rounded-full hover:bg-strawberry-700 transition">
                重置所有篩選
            </button>
        </div>
    </main>
    
    <div x-show="lightbox.isOpen" 
         x-transition:enter="transition ease-out duration-300"
         x-transition:enter-start="opacity-0"
         x-transition:enter-end="opacity-100"
         x-transition:leave="transition ease-in duration-200"
         x-transition:leave-start="opacity-100"
         x-transition:leave-end="opacity-0"
         class="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
         @click.self="closeLightbox()"
         x-cloak>
         
        <button @click="closeLightbox()" class="absolute top-4 right-4 z-[101] p-2 text-white/70 hover:text-white transition-colors">
            <i class="fa-solid fa-xmark text-4xl"></i>
        </button>

        <button x-show="lightbox.images.length > 1" 
                @click.stop="prevLightboxImage()" 
                class="absolute left-4 z-[101] p-4 text-white/50 hover:text-white transition-colors focus:outline-none">
            <i class="fa-solid fa-chevron-left text-3xl sm:text-5xl"></i>
        </button>

        <div class="relative w-full h-full flex flex-col items-center justify-center p-4 sm:p-12" @click.self="closeLightbox()">
            <template x-if="lightbox.images.length > 0">
                <img :src="lightbox.images[lightbox.currentIndex]" 
                     class="max-w-full max-h-[85vh] object-contain shadow-2xl rounded-sm select-none"
                     @click.stop=""
                     alt="Full size image">
            </template>
            <div x-show="lightbox.images.length > 1" class="absolute bottom-4 left-0 right-0 text-center text-white/80 font-medium tracking-widest text-sm">
                <span x-text="lightbox.currentIndex + 1"></span> / <span x-text="lightbox.images.length"></span>
            </div>
        </div>

        <button x-show="lightbox.images.length > 1" 
                @click.stop="nextLightboxImage()" 
                class="absolute right-4 z-[101] p-4 text-white/50 hover:text-white transition-colors focus:outline-none">
            <i class="fa-solid fa-chevron-right text-3xl sm:text-5xl"></i>
        </button>
    </div>

    <button @click="window.scrollTo({{top: 0, behavior: 'smooth'}})" 
            class="fixed bottom-6 right-6 p-3 bg-strawberry-600 text-white rounded-full shadow-lg hover:bg-strawberry-700 transition-all z-50 opacity-80 hover:opacity-100 hover:scale-110"
            x-show="showScrollTop" x-transition>
        <i class="fa-solid fa-arrow-up"></i>
    </button>

    <footer class="bg-white dark:bg-black border-t border-gray-200 dark:border-gray-800 py-8 mt-12">
        <div class="max-w-7xl mx-auto px-4 text-center text-sm text-gray-500 dark:text-gray-400">
            <p>資料整理自政府開放資料及各大農業改良場公開資訊</p>
            <p class="mt-2">&copy; 2025 草莓知識百科. By XPRAMT</p>
        </div>
    </footer>
</body>
</html>"""
    
    return html_content

def main():
    print("正在讀取資料...")
    varieties_data = load_data(VARIETIES_JSON)
    disease_data = load_data(DISEASE_JSON)
    combined_data = {**varieties_data, **disease_data}

    if not combined_data:
        print("警告: 沒有讀取到任何資料，請檢查 JSON 檔案路徑與內容。")
        return

    print("正在處理資料結構...")
    normalized_items = normalize_data(combined_data)
    
    print(f"共處理 {len(normalized_items)} 筆資料")
    print("正在生成網頁...")
    html_content = generate_html(normalized_items)
    
    with open(OUTPUT_HTML, 'w', encoding='utf-8') as f:
        f.write(html_content)
        
    print(f"成功！網頁已生成於: {OUTPUT_HTML}")

if __name__ == "__main__":
    main()