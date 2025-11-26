import json
import os

# 設定檔案路徑
INPUT_JSON = 'strawberry_data.json'
OUTPUT_HTML = 'strawberry_knowledge_base.html'

def load_data(filepath):
    """讀取 JSON 檔案"""
    if not os.path.exists(filepath):
        print(f"錯誤: 找不到檔案 {filepath}")
        return None
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"讀取 JSON 時發生錯誤: {e}")
        return None

def normalize_data(data):
    """
    將不同類型的資料(品種、病蟲害、缺素)標準化為統一格式
    以便在前端使用同一個卡片模板渲染
    """
    normalized_items = []
    
    # 1. 處理草莓品種
    for item in data.get("草莓品種", []):
        # 整理詳細資訊欄位
        details = []
        if item.get("外形外觀"):
            details.append({"label": "外觀", "value": item["外形外觀"], "icon": "fa-regular fa-eye"})
        if item.get("口味口感"):
            details.append({"label": "口感", "value": item["口味口感"], "icon": "fa-solid fa-utensils"})

        normalized_items.append({
            "id": f"var_{item['名稱']}",
            "category": "品種",
            "title": item["名稱"],
            "description": item.get("育苗簡介", "").replace('\n', '<br>'),
            "tags": item.get("tag", {}), # 包含 顏色, 來源
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

        # 判斷 icon
        icon_class = "fa-solid fa-bug" if "蟲" in item.get("tag", {}).get("類型", "") else "fa-solid fa-bacteria"

        normalized_items.append({
            "id": f"pest_{item['名稱']}",
            "category": "病蟲害",
            "title": item["名稱"],
            "description": item.get("症狀", "").replace('\n', '<br>'),
            "tags": item.get("tag", {}), # 包含 類型
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
            "images": item.get("img", []),
            "details": details,
            "sources": item.get("資料來源", []),
            "icon_fallback": "fa-solid fa-leaf"
        })

    return normalized_items

def generate_html(items):
    """生成包含 Alpine.js 邏輯的 HTML"""
    
    # 將 Python 物件轉為 JSON 字串，以便嵌入 HTML 的 Script 中
    items_json = json.dumps(items, ensure_ascii=False)

    html_content = f"""<!DOCTYPE html>
<html lang="zh-TW" class="scroll-smooth">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>草莓知識百科資料庫</title>
    
    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>
    
    <!-- Font Awesome -->
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
        /* 自定義捲軸 */
        ::-webkit-scrollbar {{ width: 8px; }}
        ::-webkit-scrollbar-track {{ background: transparent; }}
        ::-webkit-scrollbar-thumb {{ background: #cbd5e1; border-radius: 4px; }}
        ::-webkit-scrollbar-thumb:hover {{ background: #94a3b8; }}
        .dark ::-webkit-scrollbar-thumb {{ background: #475569; }}
        
        /* 針對 line-clamp 的補充 (Tailwind 預設有，但確保相容性) */
        .line-clamp-3 {{
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }}
    </style>

    <!-- 核心應用程式邏輯 (移至 Head 以確保初始化前已載入) -->
    <script>
        function appData() {{
            return {{
                rawData: {items_json},
                searchQuery: '',
                activeCategory: 'all',
                activeTags: [],
                theme: 'system',
                showScrollTop: false,
                
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

                // 根據當前分類與搜尋計算顯示項目
                get filteredItems() {{
                    if (!this.rawData) return [];
                    return this.rawData.filter(item => {{
                        // 1. 分類篩選
                        const matchCat = this.activeCategory === 'all' || item.category === this.activeCategory;
                        
                        // 2. 文字搜尋
                        const q = (this.searchQuery || '').toLowerCase();
                        const matchSearch = item.title.toLowerCase().includes(q) || 
                                          (item.description && item.description.toLowerCase().includes(q)) ||
                                          Object.values(item.tags).some(v => v && v.toLowerCase().includes(q));
                        
                        // 3. 標籤篩選 (Tag Filter)
                        let matchTags = true;
                        if (this.activeTags.length > 0) {{
                            const itemTagValues = Object.values(item.tags);
                            matchTags = this.activeTags.every(tag => itemTagValues.includes(tag));
                        }}

                        return matchCat && matchSearch && matchTags;
                    }});
                }},

                // 計算動態標籤列表
                get availableTags() {{
                    const tags = new Set();
                    if (this.rawData) {{
                        this.rawData.forEach(item => {{
                             if (this.activeCategory === 'all' || item.category === this.activeCategory) {{
                                 Object.values(item.tags).forEach(val => val && tags.add(val));
                             }}
                        }});
                    }}
                    return Array.from(tags).sort();
                }},

                getCount(catId) {{
                    if (!this.rawData) return 0;
                    if (catId === 'all') return this.rawData.length;
                    return this.rawData.filter(i => i.category === catId).length;
                }},

                toggleTagFilter(tag) {{
                    if (this.activeTags.includes(tag)) {{
                        this.activeTags = this.activeTags.filter(t => t !== tag);
                    }} else {{
                        this.activeTags.push(tag);
                    }}
                }},

                resetFilters() {{
                    this.searchQuery = '';
                    this.activeCategory = 'all';
                    this.activeTags = [];
                }},

                getCategoryBadgeClass(cat) {{
                    switch(cat) {{
                        case '品種': return 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200';
                        case '病蟲害': return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
                        case '缺素': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
                        default: return 'bg-gray-100 text-gray-800';
                    }}
                }},

                // 主題相關邏輯
                get themeIcon() {{
                    if (this.theme === 'light') return 'fa-sun';
                    if (this.theme === 'dark') return 'fa-moon';
                    return 'fa-desktop';
                }},

                initTheme() {{
                    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {{
                        document.documentElement.classList.add('dark');
                    }} else {{
                        document.documentElement.classList.remove('dark');
                    }}
                    this.theme = localStorage.theme || 'system';
                }},

                setTheme(val) {{
                    this.theme = val;
                    if (val === 'system') {{
                        localStorage.removeItem('theme');
                        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {{
                            document.documentElement.classList.add('dark');
                        }} else {{
                            document.documentElement.classList.remove('dark');
                        }}
                    }} else if (val === 'dark') {{
                        localStorage.theme = 'dark';
                        document.documentElement.classList.add('dark');
                    }} else {{
                        localStorage.theme = 'light';
                        document.documentElement.classList.remove('dark');
                    }}
                }}
            }}
        }}
    </script>
    
    <!-- Alpine.js -->
    <script src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>

</head>
<body class="bg-gray-50 text-slate-900 dark:bg-black dark:text-gray-100 transition-colors duration-300 min-h-screen"
      x-data="appData()" 
      x-init="initTheme()">

    <!-- 導航列 -->
    <nav class="sticky top-0 z-50 bg-white/90 dark:bg-black/90 backdrop-blur-md border-b border-gray-200 dark:border-gray-800 shadow-sm">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex flex-col md:flex-row justify-between items-center h-auto md:h-16 py-3 md:py-0 gap-4 md:gap-0">
                
                <!-- Logo -->
                <div class="flex items-center gap-3 cursor-pointer" @click="resetFilters()">
                    <div class="bg-strawberry-100 dark:bg-strawberry-900 p-2 rounded-full">
                        <i class="fa-solid fa-book-open text-strawberry-600 dark:text-strawberry-300 text-xl"></i>
                    </div>
                    <span class="font-bold text-xl tracking-tight">
                        草莓知識<span class="text-strawberry-600">百科</span>
                    </span>
                </div>

                <!-- 搜尋與主題切換 -->
                <div class="flex items-center gap-4 w-full md:w-auto justify-end">
                    <div class="relative w-full md:w-64">
                        <input type="text" 
                               x-model="searchQuery" 
                               placeholder="搜尋品種、症狀、關鍵字..." 
                               class="w-full pl-10 pr-4 py-2 rounded-full bg-gray-100 dark:bg-gray-800 focus:ring-2 focus:ring-strawberry-500 focus:outline-none transition-all text-sm border border-transparent focus:bg-white dark:focus:bg-gray-900 border-gray-200 dark:border-gray-700">
                        <i class="fa-solid fa-search absolute left-3 top-2.5 text-gray-400"></i>
                        <button x-show="searchQuery" @click="searchQuery = ''" class="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </div>

                    <!-- 主題切換按鈕 -->
                    <div class="relative" x-data="{{ open: false }}">
                        <button @click="open = !open" @click.outside="open = false" class="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-800 transition">
                            <i class="fa-solid" :class="themeIcon"></i>
                        </button>
                        <div x-show="open" x-transition class="absolute right-0 mt-2 w-32 bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-100 dark:border-gray-700 py-2 text-sm z-50">
                            <button @click="setTheme('light')" class="block w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2">
                                <i class="fa-regular fa-sun text-yellow-500"></i> 亮色
                            </button>
                            <button @click="setTheme('dark')" class="block w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2">
                                <i class="fa-regular fa-moon text-indigo-400"></i> 暗色
                            </button>
                            <button @click="setTheme('system')" class="block w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2">
                                <i class="fa-solid fa-desktop text-gray-500"></i> 系統
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </nav>

    <!-- 主要內容 -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        <!-- 分類標籤按鈕 -->
        <div class="flex flex-wrap justify-center gap-3 mb-8 sticky top-20 md:top-20 z-40 py-2 bg-gray-50/95 dark:bg-black/95 backdrop-blur-sm">
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

        <!-- 標籤快速篩選 (Tag Filter) -->
        <div class="mb-6 flex flex-wrap gap-2 justify-center" x-show="availableTags.length > 0">
            <span class="text-sm text-gray-500 dark:text-gray-400 flex items-center mr-2"><i class="fa-solid fa-filter mr-1"></i> 快速篩選:</span>
            <template x-for="tag in availableTags" :key="tag">
                <button @click="toggleTagFilter(tag)"
                        :class="activeTags.includes(tag) ? 'bg-gray-700 text-white dark:bg-gray-200 dark:text-gray-900' : 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300'"
                        class="px-3 py-1 rounded-md text-xs font-medium transition-colors hover:opacity-80">
                    <span x-text="tag"></span>
                </button>
            </template>
            <button x-show="activeTags.length > 0" @click="activeTags = []" class="text-xs text-red-500 hover:underline px-2">
                清除篩選
            </button>
        </div>

        <!-- 卡片網格 (調整為 PC 一行4個: lg:grid-cols-4) -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <template x-for="item in filteredItems" :key="item.id">
                <div class="bg-white dark:bg-gray-900 rounded-xl overflow-hidden shadow-lg border border-gray-200 dark:border-gray-700 card-hover flex flex-col h-full group">
                    
                    <!-- 圖片區域 (Carousel) -->
                    <div class="relative w-full h-48 bg-gray-100 dark:bg-black flex items-center justify-center overflow-hidden" 
                         x-data="{{ currentImgIdx: 0 }}">
                        
                        <!-- 有圖片時顯示 -->
                        <template x-if="item.images && item.images.length > 0">
                            <div class="w-full h-full relative">
                                <template x-for="(img, idx) in item.images" :key="idx">
                                    <img :src="img" 
                                         x-show="currentImgIdx === idx"
                                         x-transition:enter="transition opacity duration-300"
                                         x-transition:enter-start="opacity-0"
                                         x-transition:enter-end="opacity-100"
                                         class="w-full h-full object-cover absolute top-0 left-0 cursor-pointer"
                                         @click="window.open(img, '_blank')"
                                         alt="Image">
                                </template>

                                <!-- 圖片切換按鈕 (只有多張圖時顯示) -->
                                <div x-show="item.images.length > 1" class="absolute inset-0 flex justify-between items-center px-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button @click.stop="currentImgIdx = (currentImgIdx - 1 + item.images.length) % item.images.length" 
                                            class="bg-black/50 text-white p-2 rounded-full hover:bg-black/70 w-8 h-8 flex items-center justify-center">
                                        <i class="fa-solid fa-chevron-left text-xs"></i>
                                    </button>
                                    <button @click.stop="currentImgIdx = (currentImgIdx + 1) % item.images.length" 
                                            class="bg-black/50 text-white p-2 rounded-full hover:bg-black/70 w-8 h-8 flex items-center justify-center">
                                        <i class="fa-solid fa-chevron-right text-xs"></i>
                                    </button>
                                </div>
                                
                                <!-- 圖片計數指示器 -->
                                <div x-show="item.images.length > 1" class="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-md">
                                    <span x-text="currentImgIdx + 1"></span>/<span x-text="item.images.length"></span>
                                </div>
                            </div>
                        </template>

                        <!-- 無圖片時顯示預設圖示 -->
                        <template x-if="!item.images || item.images.length === 0">
                            <div class="flex flex-col items-center justify-center text-gray-300 dark:text-gray-700">
                                <i :class="item.icon_fallback" class="text-6xl mb-2 opacity-50"></i>
                                <span class="text-xs">無圖片</span>
                            </div>
                        </template>
                        
                        <!-- 類別標籤 (右上角) -->
                        <div class="absolute top-3 right-3">
                             <span class="px-2 py-1 text-xs font-bold rounded shadow-sm" 
                                   :class="getCategoryBadgeClass(item.category)" 
                                   x-text="item.category"></span>
                        </div>
                    </div>

                    <!-- 內容區域 -->
                    <div class="p-5 flex-1 flex flex-col">
                        <!-- 標題 -->
                        <div class="mb-3">
                            <h3 class="text-lg font-bold text-gray-900 dark:text-white leading-tight" x-text="item.title"></h3>
                        </div>

                        <!-- 屬性標籤 (Tags) -->
                        <div class="flex flex-wrap gap-2 mb-4">
                            <template x-for="(val, key) in item.tags" :key="key">
                                <div class="inline-flex items-center px-2.5 py-1 rounded bg-gray-100 dark:bg-gray-800 text-xs text-gray-600 dark:text-slate-200 border border-slate-300 dark:border-slate-600">
                                    <span class="opacity-70 mr-1" x-text="key + ':'"></span>
                                    <span class="font-semibold" x-text="val"></span>
                                </div>
                            </template>
                        </div>

                        <!-- 描述 (可摺疊) - 邏輯調整: 只有超過 100 字元才顯示「閱讀更多」，否則預設顯示且不摺疊 -->
                        <div x-data="{{ expanded: false }}" class="mb-4 relative">
                            <div class="prose dark:prose-invert text-sm text-slate-700 dark:text-slate-300 leading-relaxed transition-all duration-300"
                                 :class="(expanded || (item.description && item.description.length <= 100)) ? '' : 'line-clamp-3'"
                                 x-html="item.description">
                            </div>
                            
                            <!-- 展開/收合按鈕 (條件調整：長度超過 100 字元才顯示) -->
                            <button x-show="item.description && item.description.length > 100" 
                                    @click="expanded = !expanded" 
                                    class="mt-1 text-xs font-bold text-strawberry-600 dark:text-strawberry-400 hover:underline focus:outline-none flex items-center gap-1">
                                <span x-text="expanded ? '收起內容' : '閱讀更多'"></span>
                                <i class="fa-solid" :class="expanded ? 'fa-angle-up' : 'fa-angle-down'"></i>
                            </button>
                        </div>

                        <!-- 詳細資訊表格 -->
                        <div class="mt-auto space-y-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                            <template x-for="detail in item.details" :key="detail.label">
                                <div class="flex items-start gap-3 text-sm">
                                    <div class="min-w-[20px] pt-1 text-center text-gray-400">
                                        <i :class="detail.icon"></i>
                                    </div>
                                    <div>
                                        <span class="text-xs font-bold text-gray-500 dark:text-gray-500 block" x-text="detail.label"></span>
                                        <span class="text-gray-800 dark:text-gray-300" x-text="detail.value"></span>
                                    </div>
                                </div>
                            </template>
                        </div>
                        
                        <!-- 資料來源連結 -->
                        <div x-show="item.sources && item.sources.length > 0" class="mt-4 pt-2">
                             <div x-data="{{ showSources: false }}">
                                <button @click="showSources = !showSources" class="text-xs text-gray-400 hover:text-strawberry-600 flex items-center gap-1 transition-colors">
                                    <i class="fa-solid fa-link"></i>
                                    參考資料來源 (<span x-text="item.sources.length"></span>)
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

        <!-- 無結果顯示 -->
        <div x-show="filteredItems.length === 0" x-cloak class="text-center py-20">
            <div class="inline-block p-6 rounded-full bg-gray-100 dark:bg-gray-800 mb-4">
                <i class="fa-solid fa-magnifying-glass text-4xl text-gray-400"></i>
            </div>
            <h3 class="text-xl font-bold text-gray-700 dark:text-gray-300 mb-2">沒有找到相關結果</h3>
            <p class="text-gray-500">請嘗試調整搜尋關鍵字或清除篩選條件。</p>
            <button @click="resetFilters()" class="mt-6 px-6 py-2 bg-strawberry-600 text-white rounded-full hover:bg-strawberry-700 transition">
                重置所有篩選
            </button>
        </div>
    </main>

    <!-- 回到頂部按鈕 -->
    <button @click="window.scrollTo({{top: 0, behavior: 'smooth'}})" 
            class="fixed bottom-6 right-6 p-3 bg-strawberry-600 text-white rounded-full shadow-lg hover:bg-strawberry-700 transition-all z-50 opacity-80 hover:opacity-100 hover:scale-110"
            x-show="showScrollTop"
            x-transition>
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
    data = load_data(INPUT_JSON)
    if not data:
        return

    print("正在處理資料結構...")
    normalized_items = normalize_data(data)
    
    print(f"共處理 {len(normalized_items)} 筆資料")
    
    print("正在生成網頁...")
    html_content = generate_html(normalized_items)
    
    with open(OUTPUT_HTML, 'w', encoding='utf-8') as f:
        f.write(html_content)
        
    print(f"成功！網頁已生成於: {OUTPUT_HTML}")
    print("請使用瀏覽器開啟該檔案查看結果。")

if __name__ == "__main__":
    main()