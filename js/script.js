//script.js

document.addEventListener('DOMContentLoaded', () => {
    // --- 頁籤與內容管理 ---
    const tabs = document.querySelectorAll('.nav-tab');
    const contentSections = document.querySelectorAll('.content-section');

    /**
     * 根據提供的 ID 啟動對應的頁籤和內容區塊
     * @param {string} targetId - 要啟動的區塊 ID (例如 "projects")
     */
    function activateTab(targetId) {
        // 如果沒有提供 targetId，就預設為第一個區塊的 ID
        if (!targetId) {
            const firstSection = contentSections[0];
            if (!firstSection) return; // 如果沒有內容區塊，就直接返回
            targetId = firstSection.id;
        }

        // 更新內容區塊的顯示狀態
        contentSections.forEach(section => {
            section.classList.toggle('active', section.id === targetId);
        });

        // 更新導覽列頁籤的 active 狀態
        tabs.forEach(tab => {
            // 檢查 tab 的 href 是否對應 targetId
            const tabHref = tab.getAttribute('href');
            tab.classList.toggle('active', tabHref === `#${targetId}`);
        });
    }

    // --- 事件監聽 ---
    // 監聽導覽列頁籤的點擊
    tabs.forEach(tab => {
        tab.addEventListener('click', (event) => {
            const href = tab.getAttribute('href');

            // 只處理頁面內的錨點連結
            if (href && href.startsWith('#')) {
                event.preventDefault(); // 阻止頁面預設的跳轉行為
                const targetId = href.substring(1);

                // 更新 URL hash，但不要觸發 history 堆疊
                // 這會讓 URL 變更，但不會讓頁面感覺像刷新一樣
                history.pushState(null, '', href);

                // 啟動對應的頁籤
                activateTab(targetId);
            }
        });
    });

    // --- 頁面初始載入邏輯 ---
    // 檢查 URL 是否帶有 hash
    const currentHash = window.location.hash;
    if (currentHash) {
        // 如果有 hash (例如 #articles)，就啟動對應的頁籤
        const targetId = currentHash.substring(1);
        activateTab(targetId);
    } else {
        // 如果沒有 hash，就啟動預設的第一個頁籤
        activateTab();
    }


    // --- 主題切換功能 ---
    const themeSwitcher = document.getElementById('theme-switcher');
    const docElement = document.documentElement; // 使用 documentElement (<html>)

    // 檢查 localStorage 中儲存的主題偏好
    const savedTheme = localStorage.getItem('theme');
    
    // 檢查系統的色彩偏好
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

    // 決定初始主題
    // 優先級: localStorage > 系統偏好 > 預設(亮色)
    if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
        docElement.setAttribute('data-theme', 'dark');
    } else {
        docElement.setAttribute('data-theme', 'light');
    }

    // 按鈕點擊事件
    themeSwitcher.addEventListener('click', () => {
        const currentTheme = docElement.getAttribute('data-theme');
        if (currentTheme === 'dark') {
            docElement.setAttribute('data-theme', 'light');
            localStorage.setItem('theme', 'light'); // 儲存偏好
        } else {
            docElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark'); // 儲存偏好
        }
    });

    // --- 圖片庫展開功能 ---
    const galleryButtons = document.querySelectorAll('.expand-gallery-btn');

    galleryButtons.forEach(button => {
        button.addEventListener('click', () => {
            const gallery = button.previousElementSibling;
            const hiddenImages = gallery.querySelectorAll('.hidden-image');
            
            hiddenImages.forEach(image => {
                // 切換圖片的顯示狀態
                if (image.style.display === 'none' || image.style.display === '') {
                    image.style.display = 'block';
                } else {
                    image.style.display = 'none';
                }
            });

            // 更新按鈕文字
            if (button.textContent.includes('顯示更多')) {
                button.textContent = '收合圖片';
            } else {
                button.textContent = '顯示更多';
            }
        });
    });
});