document.addEventListener('DOMContentLoaded', () => {
    // --- 頁籤切換功能 ---
    const tabs = document.querySelectorAll('.nav-tab');
    const contentSections = document.querySelectorAll('.content-section');

    tabs.forEach(tab => {
        tab.addEventListener('click', (event) => {
            event.preventDefault(); // 防止頁面跳轉

            // 移除所有頁籤的 active class
            tabs.forEach(t => t.classList.remove('active'));
            // 為點擊的頁籤添加 active class
            tab.classList.add('active');

            const targetId = tab.getAttribute('data-tab');

            // 隱藏所有內容區塊
            contentSections.forEach(section => {
                section.classList.remove('active');
            });

            // 顯示對應的內容區塊
            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                targetSection.classList.add('active');
            }
        });
    });


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