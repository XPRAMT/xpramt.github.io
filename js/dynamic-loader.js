//dynamic-loader.js

document.addEventListener('DOMContentLoaded', function() {

    const projectContainer = document.getElementById('project-grid-container');
    const articleContainer = document.getElementById('article-list-container');
    // 獲取草莓區塊的容器
    const strawberryContainer = document.getElementById('strawberry-grid-container');

    fetch('manifest.json')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok ' + response.statusText);
            }
            return response.json();
        })
        .then(data => {
            // --- 處理專案 (無變動) ---
            if (data.projects && projectContainer) {
                data.projects.forEach(project => {
                    const projectCard = `
                        <div class="card project-card">
                            <h3>${project.title}</h3>
                            <p>${project.description}</p>
                            <div class="project-links">
                                <a href="${project.url}">查看詳情</a>
                                <a href="${project.github}" target="_blank" rel="noopener noreferrer">
                                    <i class="fab fa-github"></i> 查看 GitHub
                                </a>
                            </div>
                        </div>
                    `;
                    projectContainer.innerHTML += projectCard;
                });
            }

            // --- 處理文章 (無變動) ---
            if (data.articles && articleContainer) {
                data.articles.forEach(article => {
                    const tagsHTML = article.tags.map(tag => `<span class="tag">${tag}</span>`).join('');
                    const articleCard = `
                        <article class="card article-card">
                            <h3 class="article-title">${article.title}</h3>
                            <p class="article-summary">${article.summary}</p>
                            <div class="project-links">
                                <a href="${article.url}">閱讀全文</a>
                            </div>
                            <div class="article-meta">
                                ${tagsHTML}
                            </div>
                        </article>
                    `;
                    articleContainer.innerHTML += articleCard;
                });
            }

            // --- 新增：處理草莓 ---
            if (data.strawberries && strawberryContainer) {
                data.strawberries.forEach(strawberry => {
                    const strawberryCard = `
                        <div class="card info-card">
                            <h4><a href="${strawberry.url}" style="text-decoration: none; color: inherit;">${strawberry.name}</a></h4>
                            <a href="${strawberry.url}">
                                <div class="image-gallery">
                                    <img src="${strawberry.image_url}" alt="${strawberry.name} 草莓">
                                </div>
                            </a>
                            <p>${strawberry.description}</p>
                             <div class="project-links">
                                <a href="${strawberry.url}">了解更多 &raquo;</a>
                            </div>
                        </div>
                    `;
                    strawberryContainer.innerHTML += strawberryCard;
                });
            }

        })
        .catch(error => {
            console.error('無法載入內容:', error);
            if(projectContainer) projectContainer.innerHTML = "<p>專案內容載入失敗。</p>";
            if(articleContainer) articleContainer.innerHTML = "<p>文章內容載入失敗。</p>";
            // 新增錯誤處理
            if(strawberryContainer) strawberryContainer.innerHTML = "<p>草莓資訊載入失敗。</p>";
        });
});