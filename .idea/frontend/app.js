"use strict";

/* =========================================================
 * NGHỊCH THIÊN CHIẾN KÝ
 * Frontend - Part 1.3
 * File: frontend/app.js
 * ========================================================= */

const CONFIG = {
    apiBaseKey: "ntck_api_base",
    jwtKey: "ntck_jwt",
    defaultApiBase: "http://localhost:8080",
};


const state = {
    currentView: "home",
    apiBase: localStorage.getItem(CONFIG.apiBaseKey)
        || CONFIG.defaultApiBase,
    token: localStorage.getItem(CONFIG.jwtKey) || "",
    player: null,
    stages: [],
    progress: [],
    backendAvailable: false,

    // Dữ liệu đội hình
    heroes: [],
    formation: Array(9).fill(null),
    selectedHeroId: null,
    savingFormation: false,
};


const VIEW_TITLES = {
    home: "Tổng quan",
    campaign: "Chiến dịch",
    heroes: "Tướng",
    formation: "Đội hình",
    inventory: "Túi đồ",
};

const CHARACTER_ANIMATION_CONFIG = {
    TOHKA: {
        assetKey: "tohka",
        animations: {
            idle:   { frameCount: 24, fps: 10, loop: true },
            attack: { frameCount: 12, fps: 12, loop: false },

            skill1: {
                frameCount: 24,
                fps: 12,
                loop: false,
                stayInPlace: true,
                effect: "tohka_skill1"
            },

            skill2: {
                frameCount: 24,
                fps: 12,
                loop: false,
                stayInPlace: true,
                effect: "tohka_skill2"
            },

            ultimate: {
                frameCount: 40,
                fps: 15,
                loop: false,
                stayInPlace: true,
                effect: "tohka_ultimate"
            }
        }
    }
};

const characterAnimationCache = new Map();

function getCharacterAnimationConfig(unit) {
    const code = getBattleUnitCode(unit).trim();
    const normalizedCode = code.toUpperCase();

    return CHARACTER_ANIMATION_CONFIG[normalizedCode] || {
        assetKey: code.toLowerCase().replace(/[^a-z0-9_-]/g, "_") || "unknown",
        animations: {
            idle: { frameCount: 24, fps: 10, loop: true },
            attack: { frameCount: 24, fps: 12, loop: false },
        },
    };
}

function getAnimationSettings(config, animationName) {
    return config.animations?.[animationName] || {
        frameCount: config.frameCount || 24,
        fps: config.fps || 10,
        loop: animationName === "idle",
    };
}

function getUnitAnimationConfig(unit, animation) {
    const config = getCharacterAnimationConfig(unit);

    if (config.animations?.[animation]) {
        return config.animations[animation];
    }

    return config.animations?.attack || {
        frameCount: 12,
        fps: 12,
        loop: false,
        stayInPlace: false
    };
}

function getActionAnimation(action) {
    const code = String(action?.skillCode || "").toUpperCase();
    const type = String(action?.skillType || "").toUpperCase();

    if (
        type === "BASIC" ||
        code === "BASIC_DEFAULT" ||
        code.includes("BASIC")
    ) {
        return "attack";
    }

    const match = code.match(/SKILL[_-]?(\d+)/);

    if (match) {
        return `skill${Number(match[1])}`;
    }

    if (code.includes("ULTIMATE") || code.includes("ULT")) {
        return "ultimate";
    }

    return "attack";
}

function normalizeAnimationName(animation) {
    const name = String(animation || "idle").toLowerCase();

    const supportedAnimations = [
        "idle",
        "attack",
        "skill1",
        "skill2",
        "hit",
        "death"
    ];

    return supportedAnimations.includes(name) ? name : "idle";
}

function loadCharacterAnimation(unit, animation = "idle") {
    const config = getCharacterAnimationConfig(unit);
    const animationName = normalizeAnimationName(animation);
    const settings = getAnimationSettings(config, animationName);

    const cacheKey = `${config.assetKey}:${animationName}`;
    const cached = characterAnimationCache.get(cacheKey);

    if (cached?.loaded) {
        return Promise.resolve(cached.frames);
    }

    if (cached?.loading) {
        return cached.loading;
    }

    if (cached?.failed) {
        return Promise.resolve([]);
    }

    const entry = cached || {
        frames: [],
        loaded: false,
        loading: null,
        failed: false,
        fps: settings.fps,
        loop: settings.loop,
        frameCount: settings.frameCount,
    };

    entry.fps = settings.fps;
    entry.loop = settings.loop;
    entry.frameCount = settings.frameCount;

    characterAnimationCache.set(cacheKey, entry);

    entry.loading = Promise.all(
        Array.from({ length: settings.frameCount }, (_, index) =>
            new Promise((resolve, reject) => {
                const img = new Image();
                const frame = String(index).padStart(2, "0");
                const fileName =
                    `${config.assetKey}_${animationName}_${frame}.png`;

                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error(fileName));

                img.src =
                    `assets/characters/${config.assetKey}/` +
                    `${animationName}/${fileName}`;
            })
        )
    )
        .then(frames => {
            entry.frames = frames;
            entry.loaded = true;
            entry.failed = false;
            return frames;
        })
        .catch(error => {
            entry.frames = [];
            entry.loaded = false;
            entry.failed = true;

            console.debug(
                `Không tải được animation ${cacheKey}:`,
                error.message
            );

            return [];
        })
        .finally(() => {
            entry.loading = null;
        });

    return entry.loading;
}

function setBattleUnitAnimation(unit, animationName = "idle") {
    if (!unit) return;

    if (
        unit._battleAnimation === animationName &&
        unit._battleAnimationStartedAt != null
    ) {
        return;
    }

    unit._battleAnimation = animationName;
    unit._battleAnimationStartedAt = performance.now();

    const code = CharacterAnimationManager.getCharacterCode(unit);

    CharacterAnimationManager.loadAnimation(code, animationName)
        .catch(error => {
            console.error(
                `[BATTLE] Không tải được ${code}/${animationName}:`,
                error
            );
        });

    if (
        window.SpineCharacterManager &&
        SpineCharacterManager.isSample(unit)
    ) {
        const spineAnimation =
            SpineCharacterManager.getAnimationName(animationName);

        // Sẽ gọi hàm setAnimation của runtime Spine 3.5
        // sau khi đã tích hợp đúng runtime.
        SpineCharacterManager.pendingAnimation = {
            unit,
            animation: spineAnimation,
            startedAt: performance.now()
        };
    }
}

function getCharacterAnimationFrame(unit) {
    const config = getCharacterAnimationConfig(unit);
    const animation = normalizeAnimationName(
        unit._battleAnimation || "idle"
    );

    const cacheKey = `${config.assetKey}:${animation}`;
    let entry = characterAnimationCache.get(cacheKey);

    if (!entry?.loaded || !entry.frames.length) {
        if (animation !== "idle") {
            loadCharacterAnimation(unit, animation);
        }

        loadCharacterAnimation(unit, "idle");

        const idleEntry = characterAnimationCache.get(
            `${config.assetKey}:idle`
        );

        if (!idleEntry?.loaded || !idleEntry.frames.length) {
            return null;
        }

        entry = idleEntry;
    }

    const now = performance.now();
    const fps = entry.fps || 10;

    const elapsed = animation === "idle"
        ? now
        : Math.max(0, now - (unit._battleAnimationStartedAt || now));

    let frameIndex = Math.floor(elapsed / 1000 * fps);

    if (entry.loop) {
        frameIndex %= entry.frames.length;
    } else {
        frameIndex = Math.min(frameIndex, entry.frames.length - 1);
    }

    return entry.frames[frameIndex] || null;
}



function drawCharacterSprite(
    ctx,
    frame,
    unit,
    x,
    y,
    side,
    cellHeight
) {
    if (!ctx || !frame) {
        return false;
    }

    const config = CharacterAnimationManager.getConfig(unit);
    const animationName = unit._battleAnimation || "idle";

    // Chiều cao vẽ cố định cho tất cả animation.
    const targetHeight = cellHeight * (config?.scale ?? 1.65);

    // Giữ tỷ lệ theo kích thước ảnh gốc.
    const ratio = frame.width / frame.height;
    const targetWidth = targetHeight * ratio;

    // Căn giữa theo trục ngang; đặt đáy nhân vật cố định.
    const drawX = x - targetWidth / 2;
    const drawY = y - targetHeight * 0.35;

    ctx.save();

    const shouldFlip =
        (side === "enemy" && config?.flipEnemy) ||
        (side === "player" && !config?.flipEnemy && false);

    if (shouldFlip) {
        ctx.translate(x, 0);
        ctx.scale(-1, 1);

        ctx.drawImage(
            frame,
            drawX - x,
            drawY,
            targetWidth,
            targetHeight
        );
    } else {
        ctx.drawImage(
            frame,
            drawX,
            drawY,
            targetWidth,
            targetHeight
        );
    }

    ctx.restore();
    return true;
}



/* =========================================================
 * DOM HELPERS
 * ========================================================= */

function $(selector) {
    return document.querySelector(selector);
}

function $all(selector) {
    return document.querySelectorAll(selector);
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;",
        };

        return entities[char];
    });
}

function formatNumber(value) {
    const number = Number(value ?? 0);

    if (!Number.isFinite(number)) {
        return "0";
    }

    return new Intl.NumberFormat("vi-VN").format(number);
}

function showToast(message, type = "info") {
    const toast = $("#game-toast");

    if (!toast) {
        console.log(`[${type}] ${message}`);
        return;
    }

    toast.textContent = message;
    toast.className = "toast";
    toast.classList.add("show");

    if (type === "error") {
        toast.classList.add("toast-error");
    } else if (type === "success") {
        toast.classList.add("toast-success");
    }

    window.clearTimeout(showToast.timeoutId);

    showToast.timeoutId = window.setTimeout(() => {
        toast.classList.remove("show");
    }, 3000);
}

/* =========================================================
 * API CLIENT
 * ========================================================= */

function getApiUrl(path) {
    const base = state.apiBase.replace(/\/+$/, "");
    const endpoint = path.startsWith("/") ? path : `/${path}`;

    return `${base}${endpoint}`;
}

async function apiRequest(path, options = {}) {
    const headers = {
        Accept: "application/json",
        ...(options.headers || {}),
    };

    if (options.body !== undefined && options.body !== null) {
        headers["Content-Type"] = "application/json";
    }

    if (state.token) {
        headers.Authorization = `Bearer ${state.token}`;
    }

    const response = await fetch(getApiUrl(path), {
        ...options,
        headers,
    });

    const contentType = response.headers.get("content-type") || "";
    let responseData = null;

    if (response.status !== 204) {
        if (contentType.includes("application/json")) {
            responseData = await response.json();
        } else {
            responseData = await response.text();
        }
    }

    if (!response.ok) {
        let message = `HTTP ${response.status}`;

        if (typeof responseData === "string" && responseData.trim()) {
            message = responseData;
        } else if (responseData && typeof responseData === "object") {
            message =
                responseData.message
                || responseData.error
                || responseData.detail
                || message;
        }

        const error = new Error(message);
        error.status = response.status;
        throw error;
    }

    return responseData;
}

/* =========================================================
 * NAVIGATION
 * ========================================================= */

function navigateTo(viewName) {
    const view = VIEW_TITLES[viewName];

    if (!view) {
        console.warn("Màn hình không tồn tại:", viewName);
        return;
    }

    state.currentView = viewName;

    $all(".game-view").forEach((element) => {
        element.classList.toggle(
            "active",
            element.id === `view-${viewName}`
        );
    });

    $all(".nav-item[data-view]").forEach((button) => {
        button.classList.toggle(
            "active",
            button.dataset.view === viewName
        );
    });

    const title = $("#page-title");

    if (title) {
        title.textContent = view;
    }

    if (viewName === "campaign") {
        loadCampaign();
    } else if (viewName === "heroes") {
        loadHeroes();
    } else if (viewName === "formation") {
        loadFormation();
    } else if (viewName === "inventory") {
        loadInventory();
    }
}

/* =========================================================
 * MODALS
 * ========================================================= */

function openModal(selector) {
    const modal = $(selector);

    if (modal) {
        modal.classList.add("open");
    }
}

function closeModal(selector) {
    const modal = $(selector);

    if (modal) {
        modal.classList.remove("open");
    }
}

function bindModalEvents() {
    $("#open-settings")?.addEventListener("click", () => {
        const apiInput = $("#api-base-url");
        const tokenInput = $("#jwt-token");

        if (apiInput) {
            apiInput.value = state.apiBase;
        }

        if (tokenInput) {
            tokenInput.value = state.token;
        }

        openModal("#settings-modal");
    });

    $all("[data-close-settings]").forEach((element) => {
        element.addEventListener("click", () => {
            closeModal("#settings-modal");
        });
    });

    $all("[data-close-battle]").forEach((element) => {
        element.addEventListener("click", () => {
            closeModal("#battle-modal");
        });
    });

    $all(".modal").forEach((modal) => {
        modal.addEventListener("click", (event) => {
            if (event.target === modal) {
                modal.classList.remove("open");
            }
        });
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            $all(".modal.open").forEach((modal) => {
                modal.classList.remove("open");
            });
        }
    });
}

/* =========================================================
 * API SETTINGS / AUTH TOKEN
 * ========================================================= */

function updateAuthButton() {
    const button = $("#auth-button");

    if (!button) {
        return;
    }

    button.textContent = state.token
        ? "Đăng xuất"
        : "Cấu hình API / Đăng nhập";
}

function bindSettingsEvents() {
    $("#save-settings")?.addEventListener("click", async () => {
        const apiInput = $("#api-base-url");
        const tokenInput = $("#jwt-token");

        const apiBase = apiInput?.value.trim();
        const token = tokenInput?.value.trim() || "";

        if (!apiBase) {
            showToast("Mày chưa nhập địa chỉ API.", "error");
            return;
        }

        try {
            new URL(apiBase);
        } catch {
            showToast("Địa chỉ API không hợp lệ.", "error");
            return;
        }

        state.apiBase = apiBase.replace(/\/+$/, "");
        state.token = token;

        localStorage.setItem(CONFIG.apiBaseKey, state.apiBase);
        localStorage.setItem(CONFIG.jwtKey, state.token);

        updateAuthButton();
        closeModal("#settings-modal");

        showToast("Đã lưu cấu hình API.", "success");

        await refreshApplicationData();
    });

    $("#auth-button")?.addEventListener("click", () => {
        if (state.token) {
            const shouldLogout = window.confirm(
                "Mày có muốn đăng xuất khỏi game không?"
            );

            if (!shouldLogout) return;

            state.token = "";
            state.player = null;

            localStorage.removeItem(CONFIG.jwtKey);
            localStorage.removeItem("ntck_display_name");
            localStorage.removeItem("ntck_player_id");

            updateAuthButton();
            renderPlayerInfo();

            showToast("Đã đăng xuất.", "success");
            return;
        }

        openAuthModal("login");
    });
}

/* =========================================================
 * PLAYER INFO
 * ========================================================= */

function renderPlayerInfo() {
    const player = state.player;

    const levelElement = $("#player-level");
    const expElement = $("#player-exp");
    const goldElement = $("#gold");
    const premiumElement = $("#premium-currency");

    if (!player) {
        if (levelElement) levelElement.textContent = "—";
        if (expElement) expElement.textContent = "Chưa tải dữ liệu";
        if (goldElement) goldElement.textContent = "—";
        if (premiumElement) premiumElement.textContent = "—";

        return;
    }

    if (levelElement) {
        levelElement.textContent = formatNumber(player.level ?? 1);
    }

    if (expElement) {
        expElement.textContent = formatNumber(player.exp ?? 0);
    }

    if (goldElement) {
        goldElement.textContent = formatNumber(player.gold ?? 0);
    }

    if (premiumElement) {
        premiumElement.textContent = formatNumber(
            player.premiumCurrency ?? 0
        );
    }
}

async function loadPlayerInfo() {
    if (!state.token) {
        state.player = null;
        renderPlayerInfo();
        return;
    }

    try {
        state.player = await apiRequest("/api/player/me");
        renderPlayerInfo();
    } catch (error) {
        console.error("Không tải được thông tin người chơi:", error);

        if (error.status === 401 || error.status === 403) {
            showToast(
                "JWT không hợp lệ hoặc đã hết hạn. Kiểm tra lại token.",
                "error"
            );
        } else {
            showToast(
                "Không tải được thông tin người chơi: " + error.message,
                "error"
            );
        }
    }
}

/* =========================================================
 * BACKEND HEALTH CHECK
 * ========================================================= */

async function checkBackend() {
    try {
        await apiRequest("/api/health");
        state.backendAvailable = true;
        return true;
    } catch (error) {
        state.backendAvailable = false;
        console.error("Backend chưa kết nối được:", error);
        return false;
    }
}

/* =========================================================
 * CAMPAIGN
 * ========================================================= */

function normalizeArray(data) {
    if (Array.isArray(data)) {
        return data;
    }

    if (data && Array.isArray(data.content)) {
        return data.content;
    }

    if (data && Array.isArray(data.data)) {
        return data.data;
    }

    return [];
}

function getProgressByStageId() {
    const map = new Map();

    for (const item of state.progress) {
        if (item.stageId != null) {
            map.set(String(item.stageId), item);
        }
    }

    return map;
}

function getStageProgress(stage) {
    const progressMap = getProgressByStageId();
    return progressMap.get(String(stage.id)) || null;
}

function isStageUnlocked(stage, index) {
    const progress = getStageProgress(stage);

    if (typeof progress?.unlocked === "boolean") {
        return progress.unlocked;
    }

    // Nếu API progress chưa trả dữ liệu, chỉ mở ải đầu tiên.
    return index === 0;
}

function renderCampaign() {
    const container = $("#campaign-list");
    const message = $("#campaign-message");

    if (!container) {
        return;
    }

    if (state.stages.length === 0) {
        container.innerHTML = "";
        if (message) {
            message.textContent = "Chưa có dữ liệu ải. Hãy kiểm tra backend.";
        }
        return;
    }

    if (message) {
        message.textContent = state.backendAvailable
            ? "Chọn ải để xem thông tin và tiến trình."
            : "Chưa kết nối được backend.";
    }

    container.innerHTML = state.stages.map((stage, index) => {
        const progress = getStageProgress(stage);
        const unlocked = isStageUnlocked(stage, index);
        const cleared = Boolean(progress?.cleared);
        const stars = Number(progress?.stars ?? 0);

        let statusText = "Chưa mở";
        let statusClass = "locked";

        if (cleared) {
            statusText = `Đã vượt ải · ${stars}★`;
            statusClass = "cleared";
        } else if (unlocked) {
            statusText = "Có thể khiêu chiến";
            statusClass = "unlocked";
        }

        const stageName =
            stage.name
            || progress?.stageName
            || `Ải ${stage.stageNo ?? index + 1}`;

        return `
            <article class="stage-card ${statusClass}">
                <div class="stage-card-info">
                    <span class="stage-number">
                        CHƯƠNG ${escapeHtml(stage.chapterNo ?? 1)}
                        · ẢI ${escapeHtml(stage.stageNo ?? index + 1)}
                    </span>

                    <h3>${escapeHtml(stageName)}</h3>

                    <p>
                        Lực chiến đề xuất:
                        <strong>
                            ${formatNumber(stage.recommendedPower ?? 0)}
                        </strong>
                    </p>

                    <p class="stage-status">${escapeHtml(statusText)}</p>
                </div>

                <button
                    class="btn btn-primary stage-action"
                    data-stage-id="${escapeHtml(stage.id)}"
                    ${unlocked ? "" : "disabled"}
                    type="button"
                >
                    ${cleared ? "Đánh lại" : "Vào ải"}
                </button>
            </article>
        `;
    }).join("");

    container.querySelectorAll("[data-stage-id]").forEach((button) => {
        button.addEventListener("click", () => {
            const stageId = button.dataset.stageId;
            const stage = state.stages.find(
                (item) => String(item.id) === String(stageId)
            );

            if (stage) {
                handleEnterStage(stage);
            }
        });
    });
}

async function loadCampaign() {
    const container = $("#campaign-list");
    const message = $("#campaign-message");

    if (container) {
        container.innerHTML = `
            <div class="loading-state">Đang tải danh sách ải...</div>
        `;
    }

    if (message) {
        message.textContent = "";
    }

    try {
        const stagesData = await apiRequest("/api/campaign/stages");
        state.stages = normalizeArray(stagesData);

        // Tiến trình là API riêng. Nếu chưa có endpoint hoặc bị lỗi,
        // vẫn hiển thị danh sách ải.
        try {
            const progressData = await apiRequest("/api/campaign/progress");
            state.progress = normalizeArray(progressData);
        } catch (progressError) {
            console.warn(
                "Không tải được tiến trình chiến dịch:",
                progressError
            );
            state.progress = [];
        }

        renderCampaign();
    } catch (error) {
        console.error("Không tải được danh sách ải:", error);

        if (container) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>Không tải được danh sách ải</h3>
                    <p>${escapeHtml(error.message)}</p>
                    <p>Kiểm tra backend, địa chỉ API và cấu hình bảo mật.</p>
                </div>
            `;
        }

        if (message) {
            message.textContent = "Tải dữ liệu chiến dịch thất bại.";
        }
    }
}




async function handleEnterStage(stage) {
    const content = $("#battle-result-content");
    const title = $("#battle-result-title");

    if (!content) {
        showToast("Không tìm thấy vùng hiển thị trận đấu.", "error");
        return;
    }

    if (title) {
        title.textContent = stage.name || "Chiến đấu";
    }

    content.innerHTML = `
        <div class="loading-state">
            Đang tiến vào chiến trường...
        </div>
    `;

    const buttons = $all("[data-stage-id]");
    buttons.forEach(button => button.disabled = true);

    try {
        const battle = await apiRequest(
            `/api/campaign/stages/${encodeURIComponent(stage.id)}/battle`,
            { method: "POST" }
        );

        if (!battle || !Array.isArray(battle.actions)) {
            throw new Error("Dữ liệu BattleResponse không đúng định dạng.");
        }

        // Hiển thị màn hình Canvas, không mở modal kết quả ngay.
        const battleScreen = $("#battle-screen");

        if (battleScreen) {
            battleScreen.classList.remove("hidden");

            const stageName = $("#battle-stage-name");
            if (stageName) {
                stageName.textContent =
                    battle.stageName || stage.name || "Chiến trường";
            }

            battleScreen.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });

            await playBattleAnimation(battle);
        }

        // Sau khi animation kết thúc mới hiển thị kết quả.
        renderBattleResult(battle);
        openModal("#battle-modal");

        // Backend đã xử lý trận đấu và phần thưởng.
        await loadPlayerInfo();

    } catch (error) {
        console.error("Không thể bắt đầu trận đấu:", error);

        if (content) {
            content.innerHTML = `
                <div class="empty-state">
                    <h3>Không thể bắt đầu trận đấu</h3>
                    <p>${escapeHtml(error.message)}</p>
                    <p>
                        Kiểm tra đội hình, JWT và log lỗi từ backend.
                    </p>
                    <button
                        type="button"
                        class="btn btn-secondary"
                        id="battle-error-back"
                    >
                        Đóng
                    </button>
                </div>
            `;

            openModal("#battle-modal");

            $("#battle-error-back")?.addEventListener("click", () => {
                closeModal("#battle-modal");
            });
        }
    } finally {
        await loadCampaign();
    }
}


const battleCanvasController = {
    battle: null,
    canvas: null,
    ctx: null,
    units: [],
    actions: [],
    actionIndex: 0,
    speed: 1,
    skipped: false,
    running: false,
    timer: null,
    animationFrame: null,
    lastAttack: null,
    floatingTexts: [],
    resolve: null,
    lastTime: 0,
    elapsed: 0
};

function battleSleep(ms) {
    return new Promise(resolve => {
        battleCanvasController.timer = setTimeout(resolve, ms);
    });
}

function getBattleUnitCode(unit) {
    return String(
        unit?.code ??
        unit?.heroCode ??
        unit?.unitCode ??
        unit?.playerHeroId ??
        unit?.id ??
        ""
    );
}

function getBattleUnitName(unit) {
    return String(
        unit?.heroName ??
        unit?.name ??
        unit?.code ??
        unit?.heroCode ??
        "Chiến binh"
    );
}

function getBattleUnitHp(unit) {
    const value = Number(unit?.hp ?? unit?.currentHp ?? 0);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function getBattleUnitMaxHp(unit) {
    const value = Number(unit?.maxHp ?? unit?.hp ?? unit?.currentHp ?? 1);
    return Number.isFinite(value) ? Math.max(1, value) : 1;
}

function getBattleUnitAlive(unit) {
    return unit?.alive !== false && getBattleUnitHp(unit) > 0;
}



function prepareCanvasBattle(battle) {
    const controller = battleCanvasController;

    controller.battle = battle;
    controller.canvas = $("#battle-canvas");

    if (!controller.canvas) {
        throw new Error("Không tìm thấy canvas #battle-canvas.");
    }

    controller.ctx = controller.canvas.getContext("2d");

    if (!controller.ctx) {
        throw new Error("Trình duyệt không hỗ trợ Canvas 2D.");
    }

    const players = Array.isArray(battle.playerTeam)
        ? battle.playerTeam
        : [];

    const enemies = Array.isArray(battle.enemyTeam)
        ? battle.enemyTeam
        : [];

    controller.units = [
        ...players.map((unit, index) => ({
            ...unit,
            _battleSide: "player",
            _battleIndex: index,
            _battleHp: getBattleUnitHp(unit),
            _battleMaxHp: getBattleUnitMaxHp(unit),
            _battleAlive: getBattleUnitAlive(unit),
            _battleFlash: 0,
            _battleOffsetX: 0,
            _battleOffsetY: 0
        })),
        ...enemies.map((unit, index) => ({
            ...unit,
            _battleSide: "enemy",
            _battleIndex: index,
            _battleHp: getBattleUnitHp(unit),
            _battleMaxHp: getBattleUnitMaxHp(unit),
            _battleAlive: getBattleUnitAlive(unit),
            _battleFlash: 0,
            _battleOffsetX: 0,
            _battleOffsetY: 0
        }))
    ];

    controller.actions = [...(battle.actions || [])].sort((a, b) =>
        Number(a.turnNo ?? 0) - Number(b.turnNo ?? 0) ||
        Number(a.actionOrder ?? 0) - Number(b.actionOrder ?? 0)
    );

    controller.actionIndex = 0;
    controller.skipped = false;
    controller.running = true;
    controller.lastAttack = null;
    controller.floatingTexts = [];
    controller.elapsed = 0;

    // Resize Canvas 2D.
    resizeBattleCanvas();

    // Preload animation PNG cũ.
    CharacterAnimationManager.preloadCharacters(controller.units)
        .then(() => {
            drawBattleCanvas();
        })
        .catch(error => {
            console.error(
                "[BATTLE] Character preload error:",
                error
            );
        });

    // Khởi tạo Spine đúng một lần.
    const spineManager = window.SpineCharacterManager;

    if (!spineManager) {
        console.warn(
            "[BATTLE] SpineCharacterManager chưa được nạp."
        );
        return;
    }

    console.log("[BATTLE] Bắt đầu khởi tạo Spine...");

    requestAnimationFrame(() => {
        spineManager.initialize()
            .then(() => {
                requestAnimationFrame(() => {
                    spineManager.resize();

                    console.log(
                        "[BATTLE] Spine initialized:",
                        spineManager.getStatus()
                    );
                });
            })
            .catch(error => {
                console.error(
                    "[BATTLE] Spine initialization failed:",
                    error
                );
            });
    });
}



function resizeBattleCanvas() {
    const controller = battleCanvasController;
    const canvas = controller.canvas;

    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const width = Math.max(320, rect.width);
    const height = Math.max(240, rect.height || width * 9 / 16);

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    controller.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    controller.width = width;
    controller.height = height;
}

function findBattleActor(action) {
    const code = String(action?.actorCode ?? "");
    const name = String(action?.actorName ?? "");

    return battleCanvasController.units.find(unit =>
        (code && getBattleUnitCode(unit) === code) ||
        (name && getBattleUnitName(unit) === name)
    );
}

function findBattleTarget(action) {
    const code = String(action?.targetCode ?? "");
    const name = String(action?.targetName ?? "");

    return battleCanvasController.units.find(unit =>
        (code && getBattleUnitCode(unit) === code) ||
        (name && getBattleUnitName(unit) === name)
    );
}

function drawBattleCanvas() {
    const c = battleCanvasController;
    if (!c.ctx || !c.canvas) return;

    const ctx = c.ctx;
    const width = c.width || 960;
    const height = c.height || 540;

    // Bầu trời đêm.
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#101b35");
    sky.addColorStop(0.55, "#20243a");
    sky.addColorStop(1, "#080d18");

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    // Trăng.
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "#f2dfad";
    ctx.beginPath();
    ctx.arc(width * 0.5, height * 0.19, Math.min(width, height) * 0.065, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(
        width * 0.5 + 13,
        height * 0.19 - 7,
        Math.min(width, height) * 0.057,
        0,
        Math.PI * 2
    );
    ctx.fill();
    ctx.restore();

    // Núi phía xa.
    ctx.fillStyle = "#172039";
    ctx.beginPath();
    ctx.moveTo(0, height * 0.58);
    for (let i = 0; i <= 8; i++) {
        const x = width * i / 8;
        const y = height * (0.34 + (i % 2) * 0.13);
        ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();

    // Mặt đất.
    const ground = ctx.createLinearGradient(0, height * 0.58, 0, height);
    ground.addColorStop(0, "#34374a");
    ground.addColorStop(1, "#101521");

    ctx.fillStyle = ground;
    ctx.fillRect(0, height * 0.58, width, height * 0.42);

    // Vòng trận pháp.
    ctx.save();
    ctx.strokeStyle = "rgba(218, 184, 112, 0.18)";
    ctx.lineWidth = 1;

    for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(
            width * 0.5,
            height * 0.78,
            width * (0.17 + i * 0.07),
            height * (0.035 + i * 0.02),
            0,
            0,
            Math.PI * 2
        );
        ctx.stroke();
    }
    ctx.restore();

    // Tên hai phe.
    ctx.save();
    ctx.font = `bold ${Math.max(12, width * 0.018)}px serif`;
    ctx.textAlign = "center";

    ctx.fillStyle = "#79c9ff";
    ctx.fillText("TIÊN MINH", width * 0.23, height * 0.12);

    ctx.fillStyle = "#ff8585";
    ctx.fillText("MA QUÂN", width * 0.77, height * 0.12);
    ctx.restore();

    drawBattleTeam("player");
    drawBattleTeam("enemy");
    drawBattleAttackEffect();
    drawBattleFloatingTexts();
}


function getBattleFormationSlot(unit) {
    // Nếu backend đã trả slotNo thì dùng trực tiếp.
    const directSlot = Number(unit?.slotNo);

    if (Number.isInteger(directSlot) && directSlot >= 1 && directSlot <= 9) {
        return directSlot;
    }

    // Phe người chơi: đối chiếu với đội hình đã lưu.
    if (unit?._battleSide === "player" || !unit?._battleSide) {
        const formation = Array.isArray(state.formation)
            ? state.formation
            : [];

        const playerHeroId = unit?.playerHeroId;
        const heroCode = String(unit?.heroCode ?? unit?.code ?? "");

        const entry = formation.find(slot => {
            if (!slot) return false;

            // Hỗ trợ cả cấu trúc mảng 9 phần tử và object có slotNo.
            const sameHero =
                playerHeroId != null &&
                String(slot.playerHeroId ?? slot.playerHero?.id ?? "") ===
                String(playerHeroId);

            const sameCode =
                heroCode !== "" &&
                String(slot.code ?? slot.heroCode ?? slot.playerHero?.code ?? "") ===
                heroCode;

            return sameHero || sameCode;
        });

        if (entry) {
            const savedSlot = Number(entry.slotNo);

            if (Number.isInteger(savedSlot) && savedSlot >= 1 && savedSlot <= 9) {
                return savedSlot;
            }

            // Nếu state.formation là mảng 9 ô, index chính là slotNo - 1.
            const index = formation.indexOf(entry);

            if (index >= 0 && index < 9) {
                return index + 1;
            }
        }
    }

    // Fallback nếu backend chưa trả slotNo và không tìm được đội hình đã lưu.
    return Number(unit?._battleIndex ?? 0) + 1;
}







function drawBattleTeam(side) {
    const c = battleCanvasController;
    const ctx = c.ctx;

    const units = c.units.filter(
        unit => unit._battleSide === side
    );

    const isPlayer = side === "player";

    const formation = state.formation?.[side] ?? [];

    const slots = [
        [0, 0],
        [1, 0],
        [2, 0],
        [0, 1],
        [1, 1]
    ];

    units.forEach((unit, index) => {
        const [col, row] = slots[index] || [
            index % 3,
            Math.floor(index / 3)
        ];

        const mirroredCol = isPlayer ? col : 2 - col;

        const x =
            c.width * (isPlayer ? 0.25 : 0.75) +
            (mirroredCol - 1) * Math.min(c.width * 0.105, 100) +
            (unit._battleOffsetX || 0);

        const y =
            c.height * 0.56 +
            (row - 0.5) * Math.min(c.height * 0.235, 112) +
            (unit._battleOffsetY || 0);

        const cellHeight = Math.min(c.height * 0.235, 112);

        // Bóng dưới nhân vật.
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.ellipse(
            x,
            y + cellHeight * 0.34,
            cellHeight * 0.25,
            cellHeight * 0.07,
            0,
            0,
            Math.PI * 2
        );
        ctx.fill();
        ctx.restore();

        // Lấy animation hiện tại của nhân vật.
        const characterConfig =
            CharacterAnimationManager.getConfig(unit);

        const animationName = unit._battleAnimation || "idle";

        const elapsedSeconds = animationName === "idle"
            ? null
            : (
            performance.now() -
            (unit._battleAnimationStartedAt ??
                performance.now())
        ) / 1000;

        const animationConfig =
            characterConfig?.animations?.[animationName];

        const animationEntry = CharacterAnimationManager.cache.get(
            CharacterAnimationManager.getCacheKey(
                CharacterAnimationManager.getCharacterCode(unit),
                animationName
            )
        );

        const characterFrame = characterConfig
            ? CharacterAnimationManager.getFrame(
                unit,
                animationName,
                elapsedSeconds
            )
            : null;

        // Nếu animation một lần đã kết thúc thì quay về idle.
        if (
            animationName !== "idle" &&
            animationConfig?.loop === false &&
            animationEntry?.status === "loaded" &&
            elapsedSeconds >=
            animationEntry.frames.length /
            Math.max(1, animationConfig.fps ?? 10)
        ) {
            setBattleUnitAnimation(unit, "idle");
        }

        const spriteDrawn = characterFrame
            ? drawCharacterSprite(
                ctx,
                characterFrame,
                unit,
                x,
                y,
                side,
                cellHeight
            )
            : false;

        // Giữ fallback để nhân vật không biến mất khi chưa tải ảnh.
        if (!spriteDrawn) {
            ctx.save();
            ctx.fillStyle = isPlayer ? "#4f8cff" : "#e65b5b";
            ctx.beginPath();
            ctx.arc(
                x,
                y,
                Math.max(12, cellHeight * 0.16),
                0,
                Math.PI * 2
            );
            ctx.fill();
            ctx.restore();
        }

        // Tên nhân vật.
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "bold 12px sans-serif";
        ctx.fillStyle = "#fff";
        ctx.shadowColor = "#000";
        ctx.shadowBlur = 4;

        ctx.fillText(
            String(unit.name ?? unit.code ?? ""),
            x,
            y + cellHeight * 0.42
        );

        ctx.restore();

        // Thanh HP.
        const barWidth = Math.min(c.width * 0.12, 100);
        const barHeight = 7;
        const barX = x - barWidth / 2;
        const barY = y + cellHeight * 0.50;

        const maxHp = Math.max(
            1,
            Number(unit._battleMaxHp ?? unit.maxHp ?? 1)
        );

        const hp = Math.max(
            0,
            Math.min(maxHp, Number(unit._battleHp ?? maxHp))
        );

        ctx.save();

        ctx.fillStyle = "#333";
        ctx.fillRect(barX, barY, barWidth, barHeight);

        ctx.fillStyle = hp / maxHp > 0.5
            ? "#4ade80"
            : hp / maxHp > 0.2
                ? "#facc15"
                : "#f87171";

        ctx.fillRect(
            barX,
            barY,
            barWidth * (hp / maxHp),
            barHeight
        );

        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barWidth, barHeight);

        ctx.restore();
    });
}






/* =========================================================
 * CHARACTER CONFIGURATION
 * ========================================================= */


const CHARACTER_CONFIG = {
    TOHKA: {
        name: "TOHKA",
        assetPath: "assets/characters/tohka",
        scale: 1.65,
        flipEnemy: true,
        animations: {
            idle: {
                prefix: "tohka_idle_",
                frameCount: 24,
                fps: 10,
                extension: "png",
                startIndex: 0,
                padding: 2
            },
            skill1: {
                prefix: "tohka_skill1_",
                frameCount: 21,
                fps: 12,
                extension: "png",
                startIndex: 0,
                padding: 2,
                loop: false
            },
            skill2: {
                prefix: "tohka_skill2_",
                frameCount: 21,
                fps: 12,
                extension: "png",
                startIndex: 0,
                padding: 2,
                loop: false
            }
        }
    },

    DOC_VU: {
        name: "Độc Vũ",
        assetPath: "assets/characters/tohka",
        scale: 1.65,
        flipEnemy: true,
        animations: {
            idle: {
                prefix: "tohka_idle_",
                frameCount: 24,
                fps: 10,
                extension: "png",
                startIndex: 0,
                padding: 2
            },
            skill1: {
                prefix: "tohka_skill1_",
                frameCount: 21,
                fps: 12,
                extension: "png",
                startIndex: 0,
                padding: 2,
                loop: false
            },
            skill2: {
                prefix: "tohka_skill2_",
                frameCount: 21,
                fps: 12,
                extension: "png",
                startIndex: 0,
                padding: 2,
                loop: false
            }
        }
    },

    HUYET_LANG: {
        name: "Huyết Lang",
        assetPath: "assets/characters/tohka",
        scale: 1.65,
        flipEnemy: true,
        animations: {
            idle: {
                prefix: "tohka_idle_",
                frameCount: 24,
                fps: 10,
                extension: "png",
                startIndex: 0,
                padding: 2
            }
        }
    },

    THIET_THI: {
        name: "Thiết Thi",
        assetPath: "assets/characters/tohka",
        scale: 1.65,
        flipEnemy: true,
        animations: {
            idle: {
                prefix: "tohka_idle_",
                frameCount: 24,
                fps: 10,
                extension: "png",
                startIndex: 0,
                padding: 2
            }
        }
    },

    LINH_HO: {
        name: "Linh Hồ",
        assetPath: "assets/characters/tohka",
        scale: 1.65,
        flipEnemy: true,
        animations: {
            idle: {
                prefix: "tohka_idle_",
                frameCount: 24,
                fps: 10,
                extension: "png",
                startIndex: 0,
                padding: 2
            }
        }
    },

    HAC_Y: {
        name: "Hắc Y",
        assetPath: "assets/characters/tohka",
        scale: 1.65,
        flipEnemy: true,
        animations: {
            idle: {
                prefix: "tohka_idle_",
                frameCount: 24,
                fps: 10,
                extension: "png",
                startIndex: 0,
                padding: 2
            }
        }
    },

    /*
     * Khi thêm nhân vật mới, khai báo thêm tại đây.
     * Chỉ bật cấu hình sau khi đã có đủ ảnh tương ứng.
     *
     * THIET_THI: {
     *     name: "Thiết Thi",
     *     assetPath: "assets/characters/thiet_thi",
     *     scale: 1.5,
     *     flipEnemy: true,
     *     animations: {
     *         idle: {
     *             prefix: "thiet_thi_idle_",
     *             frameCount: 12,
     *             fps: 8,
     *             extension: "png",
     *             startIndex: 0,
     *             padding: 2
     *         }
     *     }
     * }
     */
};


/* =========================================================
 * CHARACTER ANIMATION MANAGER
 * ========================================================= */

const CharacterAnimationManager = {
    cache: new Map(),

    getCharacterCode(unit) {
        return String(
            unit?.code ??
            unit?.heroCode ??
            unit?.unitCode ??
            unit?.actorCode ??
            ""
        ).trim().toUpperCase();
    },

    getConfig(unitOrCode) {
        const code = typeof unitOrCode === "string"
            ? unitOrCode.trim().toUpperCase()
            : this.getCharacterCode(unitOrCode);

        return CHARACTER_CONFIG[code] ?? null;
    },

    getCacheKey(code, animationName) {
        return `${code}:${animationName}`;
    },

    async loadAnimation(code, animationName = "idle") {
        const config = this.getConfig(code);
        const animation = config?.animations?.[animationName];

        if (!config || !animation) {
            return [];
        }

        const cacheKey = this.getCacheKey(code, animationName);
        const cached = this.cache.get(cacheKey);

        if (cached?.status === "loaded") {
            return cached.frames;
        }

        if (cached?.promise) {
            return cached.promise;
        }

        const entry = {
            status: "loading",
            frames: [],
            promise: null
        };

        entry.promise = Promise.all(
            Array.from(
                { length: animation.frameCount },
                (_, index) => {
                    const frameNumber =
                        index + (animation.startIndex ?? 0);

                    const fileName =
                        animation.prefix +
                        String(frameNumber).padStart(
                            animation.padding ?? 2,
                            "0"
                        ) +
                        "." +
                        (animation.extension ?? "png");

                    const image = new Image();

                    return new Promise((resolve, reject) => {
                        image.onload = () => resolve(image);

                        image.onerror = () => reject(
                            new Error(
                                `Không tải được ${code}/${animationName}/${fileName}`
                            )
                        );

                        image.src =
                            `${config.assetPath}/${animationName}/${fileName}`;
                    });
                }
            )
        ).then(frames => {
            entry.status = "loaded";
            entry.frames = frames;
            return frames;
        }).catch(error => {
            this.cache.delete(cacheKey);
            console.error(
                `[CHARACTER] Lỗi tải animation ${code}/${animationName}:`,
                error
            );
            throw error;
        });

        this.cache.set(cacheKey, entry);

        return entry.promise;
    },


    getFrame(unit, animationName = "idle", elapsedSeconds = null) {
        const code = this.getCharacterCode(unit);
        const config = this.getConfig(code);
        const animation = config?.animations?.[animationName];

        if (!animation) {
            return null;
        }

        const entry = this.cache.get(
            this.getCacheKey(code, animationName)
        );

        if (entry?.status !== "loaded" || !entry.frames.length) {
            return null;
        }

        const elapsed = elapsedSeconds ?? performance.now() / 1000;
        const fps = Math.max(1, animation.fps ?? 10);
        const rawIndex = Math.floor(elapsed * fps);

        const frameIndex = animation.loop === false
            ? Math.min(rawIndex, entry.frames.length - 1)
            : rawIndex % entry.frames.length;

        return entry.frames[frameIndex] ?? null;
    },


    async preloadCharacters(units) {
        const codes = [
            ...new Set(
                (units ?? [])
                    .map(unit => this.getCharacterCode(unit))
                    .filter(code => this.getConfig(code))
            )
        ];

        const results = await Promise.allSettled(
            codes.flatMap(code => {
                const config = this.getConfig(code);

                return Object.keys(config.animations).map(
                    animationName =>
                        this.loadAnimation(code, animationName)
                );
            })
        );

        const failed = results.filter(
            result => result.status === "rejected"
        );

        if (failed.length) {
            console.warn(
                `[CHARACTER] Có ${failed.length} animation không tải được.`
            );
        }
    }
};


function setBattleUnitAnimation(unit, animationName = "idle") {
    if (!unit) return;

    if (
        unit._battleAnimation === animationName &&
        unit._battleAnimationStartedAt != null
    ) {
        return;
    }

    unit._battleAnimation = animationName;
    unit._battleAnimationStartedAt = performance.now();

    const code = CharacterAnimationManager.getCharacterCode(unit);

    CharacterAnimationManager.loadAnimation(code, animationName)
        .catch(error => {
            console.error(
                `[BATTLE] Không tải được ${code}/${animationName}:`,
                error
            );
        });
}



/* =========================================================
 * GENERIC CHARACTER SPRITE DRAWING
 * ========================================================= */



function drawCharacterSprite(
    ctx,
    frame,
    unit,
    x,
    y,
    side,
    cellHeight
) {
    if (!ctx || !frame) {
        return false;
    }

    const config = CharacterAnimationManager.getConfig(unit);
    const animationName = unit._battleAnimation || "idle";

    // Khung chuẩn lấy theo ảnh idle.
    const BASE_WIDTH = 272;
    const BASE_HEIGHT = 266;

    const targetHeight = cellHeight * (config?.scale ?? 1.65);
    const targetWidth = targetHeight * BASE_WIDTH / BASE_HEIGHT;

    // Fit ảnh vào khung chuẩn, giữ nguyên tỷ lệ.
    const scale = Math.min(
        targetWidth / frame.width,
        targetHeight / frame.height
    );

    const drawWidth = frame.width * scale;
    const drawHeight = frame.height * scale;

    // Căn giữa ngang và căn đáy để tránh nhân vật nhảy vị trí.
    const drawX = x - drawWidth / 2;
    const groundY = y + targetHeight * 0.35;
    const drawY = groundY - drawHeight;

    ctx.save();

    const shouldFlip =
        side === "enemy" && config?.flipEnemy;

    if (shouldFlip) {
        ctx.translate(x, 0);
        ctx.scale(-1, 1);

        ctx.drawImage(
            frame,
            drawX - x,
            drawY,
            drawWidth,
            drawHeight
        );
    } else {
        ctx.drawImage(
            frame,
            drawX,
            drawY,
            drawWidth,
            drawHeight
        );
    }

    ctx.restore();
    return true;
}




/* =========================================================
 * BACKWARD-COMPATIBLE TOHKA HELPERS
 * Giữ tương thích trong lúc chuyển đổi các hàm còn lại.
 * ========================================================= */

function drawTohkaSprite(ctx, img, x, y, side, cellHeight) {
    return drawCharacterSprite(
        ctx,
        img,
        { code: "TOHKA" },
        x,
        y,
        side,
        cellHeight
    );
}

function loadTohkaIdleFrames() {
    return CharacterAnimationManager.loadAnimation("TOHKA", "idle");
}

function getTohkaIdleFrame() {
    return CharacterAnimationManager.getFrame(
        { code: "TOHKA" },
        "idle"
    );
}



function drawBattleAttackEffect() {
    const c = battleCanvasController;
    const effect = c.lastAttack;

    if (!effect || effect.progress >= 1) return;

    const ctx = c.ctx;
    const width = c.width;
    const height = c.height;

    const actions = effect.actions || [effect.action];
    const actor = findBattleActor(actions[0]);

    if (!actor) return;

    function getPosition(unit) {
        const isPlayer = unit._battleSide === "player";

        const units = c.units.filter(
            item => item._battleSide === unit._battleSide
        );

        const index = units.indexOf(unit);
        const slots = [
            [0, 0], [1, 0], [2, 0],
            [0, 1], [1, 1]
        ];

        const [col, row] = slots[index] || [
            index % 3,
            Math.floor(index / 3)
        ];

        const mirroredCol = isPlayer ? col : 2 - col;

        return {
            x: width * (isPlayer ? 0.25 : 0.75)
                + (mirroredCol - 1) * Math.min(width * 0.105, 100)
                + (unit._battleOffsetX || 0),
            y: height * 0.56
                + (row - 0.5) * Math.min(height * 0.235, 112)
                + (unit._battleOffsetY || 0)
        };
    }

    const from = getPosition(actor);
    const progress = effect.progress;

    // Vẽ đường kiếm bay đến từng mục tiêu trong cùng lượt thi triển.
    for (const action of actions) {
        const target = findBattleTarget(action);

        if (!target) continue;

        const to = getPosition(target);
        const x = from.x + (to.x - from.x) * progress;
        const y = from.y + (to.y - from.y) * progress;

        ctx.save();

        ctx.strokeStyle = actor._battleSide === "player"
            ? "#8be6ff"
            : "#ff7777";

        ctx.lineWidth = 4;
        ctx.shadowBlur = 18;
        ctx.shadowColor = ctx.strokeStyle;

        ctx.beginPath();
        ctx.moveTo(
            x - (to.x - from.x) * 0.08,
            y - (to.y - from.y) * 0.08
        );
        ctx.lineTo(x, y);
        ctx.stroke();

        ctx.fillStyle = "#fff5ce";
        ctx.beginPath();
        ctx.arc(
            x,
            y,
            5 + Math.sin(progress * Math.PI) * 5,
            0,
            Math.PI * 2
        );
        ctx.fill();

        ctx.restore();
    }
}


function drawBattleFloatingTexts() {
    const c = battleCanvasController;
    const ctx = c.ctx;

    c.floatingTexts.forEach(text => {
        const alpha = Math.max(0, 1 - text.age / text.duration);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign = "center";
        ctx.font = `bold ${Math.max(16, c.width * 0.025)}px serif`;
        ctx.fillStyle = text.color;
        ctx.shadowBlur = 8;
        ctx.shadowColor = "#000";
        ctx.fillText(
            text.text,
            text.x,
            text.y - text.age * 25
        );
        ctx.restore();
    });
}

function updateBattleActionCaption(action) {
    const turnLabel = $("#battle-turn-label");
    const currentAction = $("#battle-current-action");
    const caption = $("#battle-action-caption");

    const actor = action.actorName || action.actorCode || "Tướng";
    const skill = action.skillName || action.skillCode || "Tấn công";
    const target = action.targetName || action.targetCode || "đối thủ";
    const message = action.message || `${actor} sử dụng ${skill} lên ${target}.`;

    if (turnLabel) {
        turnLabel.textContent = `Lượt ${formatNumber(action.turnNo ?? 0)}`;
    }

    if (currentAction) {
        currentAction.textContent = message;
    }

    if (caption) {
        caption.textContent = `${actor} · ${skill} · ${target}`;
    }
}

function findBattleUnit(code) {
    if (!code) return null;

    const teams = [
        c.playerTeam || [],
        c.enemyTeam || [],
        c.players || [],
        c.enemies || []
    ];

    for (const team of teams) {
        const unit = team.find(
            u => u.code === code || u.heroCode === code
        );

        if (unit) return unit;
    }

    return null;
}

async function playOneBattleAction(actions) {
    const c = battleCanvasController;

    if (c.skipped) return;

    const actionList = Array.isArray(actions)
        ? actions
        : [actions];

    if (actionList.length === 0) return;

    const firstAction = actionList[0];
    const actor = findBattleActor(firstAction);

    updateBattleActionCaption(firstAction);

    const animationName = getActionAnimation(firstAction);

    if (actor) {
        setBattleUnitAnimation(actor, animationName);

        actor._battleOffsetX =
            actor._battleSide === "player" ? 24 : -24;
    }

    c.lastAttack = {
        side: actor?._battleSide || "player",
        action: firstAction,
        actions: actionList,
        progress: 0
    };

    // Đợi ảnh animation được tải nếu chưa có trong cache.
    let animationDuration = 420;

    if (actor) {
        const code = CharacterAnimationManager.getCharacterCode(actor);
        const config = CharacterAnimationManager.getConfig(code);
        const animation = config?.animations?.[animationName];

        if (animation) {
            try {
                const frames =
                    await CharacterAnimationManager.loadAnimation(
                        code,
                        animationName
                    );

                if (animation.loop === false) {
                    animationDuration =
                        frames.length /
                        Math.max(1, animation.fps ?? 10) *
                        1000;
                }
            } catch (error) {
                console.error(
                    `[BATTLE] Lỗi tải ${code}/${animationName}:`,
                    error
                );
            }
        }
    }

    if (c.skipped) {
        if (actor) {
            actor._battleOffsetX = 0;
            setBattleUnitAnimation(actor, "idle");
        }
        c.lastAttack = null;
        return;
    }

    const duration = animationDuration / c.speed;
    const started = performance.now();

    await new Promise(resolve => {
        function frame(now) {
            if (c.skipped) {
                resolve();
                return;
            }

            const progress = Math.min(
                1,
                (now - started) / Math.max(1, duration)
            );

            if (c.lastAttack) {
                c.lastAttack.progress = progress;
            }

            drawBattleCanvas();

            if (progress < 1) {
                c.animationFrame = requestAnimationFrame(frame);
            } else {
                resolve();
            }
        }

        c.animationFrame = requestAnimationFrame(frame);
    });

    if (actor) {
        actor._battleOffsetX = 0;
        setBattleUnitAnimation(actor, "idle");
    }

    if (c.skipped) {
        c.lastAttack = null;
        drawBattleCanvas();
        return;
    }

    // Áp dụng sát thương riêng cho từng mục tiêu.
    for (const action of actionList) {
        const target = findBattleTarget(action);

        if (!target) {
            console.warn(
                "Không tìm thấy mục tiêu của battle action:",
                action
            );
            continue;
        }

        const damage = Math.max(
            0,
            Number(action.damage ?? 0)
        );

        if (damage > 0) {
            target._battleHp = Math.max(
                0,
                target._battleHp - damage
            );

            const targetUnits = c.units.filter(
                unit => unit._battleSide === target._battleSide
            );

            const targetIndex = targetUnits.indexOf(target);

            const slots = [
                [0, 0], [1, 0], [2, 0],
                [0, 1], [1, 1]
            ];

            const [col, row] = slots[targetIndex] || [
                targetIndex % 3,
                Math.floor(targetIndex / 3)
            ];

            const isPlayer = target._battleSide === "player";
            const mirroredCol = isPlayer ? col : 2 - col;

            const targetX =
                c.width * (isPlayer ? 0.25 : 0.75) +
                (mirroredCol - 1) * Math.min(c.width * 0.105, 100);

            const targetY =
                c.height * 0.56 +
                (row - 0.5) * Math.min(c.height * 0.235, 112);

            c.floatingTexts.push({
                text: `-${formatNumber(damage)}`,
                x: targetX,
                y: targetY,
                age: 0,
                duration: 1.1,
                color: "#ff7777"
            });
        }

        const targetHp = action.targetHpAfter ?? action.targetHp;

        if (targetHp != null) {
            target._battleHp = Math.max(
                0,
                Number(targetHp) || 0
            );
        }

        if (action.targetAlive != null) {
            target._battleAlive = Boolean(action.targetAlive);
        } else {
            target._battleAlive = target._battleHp > 0;
        }

        target._battleFlash = 1;
    }

    c.lastAttack = null;
    drawBattleCanvas();

    await battleSleep(300 / c.speed);
}


function startBattleCanvasLoop() {
    const c = battleCanvasController;

    cancelAnimationFrame(c.animationFrame);

    function frame(now) {
        if (!c.running) return;

        if (!c.lastTime) c.lastTime = now;
        const delta = Math.min(0.05, (now - c.lastTime) / 1000);
        c.lastTime = now;

        c.elapsed += delta;

        c.floatingTexts.forEach(item => {
            item.age += delta;
        });

        c.floatingTexts = c.floatingTexts.filter(
            item => item.age < item.duration
        );

        c.units.forEach(unit => {
            unit._battleFlash = Math.max(
                0,
                (unit._battleFlash || 0) - delta * 2
            );
        });

        drawBattleCanvas();
        c.animationFrame = requestAnimationFrame(frame);
    }

    c.animationFrame = requestAnimationFrame(frame);
}


function showBattleStartOverlay() {
    const c = battleCanvasController;
    const canvas = c.canvas;

    if (!canvas?.parentElement) {
        return new Promise(resolve => setTimeout(resolve, 2000));
    }

    const parent = canvas.parentElement;
    const overlay = document.createElement("div");

    overlay.className = "battle-start-overlay";
    overlay.textContent = "KHAI CHIẾN";

    const previousPosition = parent.style.position;

    if (getComputedStyle(parent).position === "static") {
        parent.style.position = "relative";
    }

    Object.assign(overlay.style, {
        position: "absolute",
        inset: "0",
        zIndex: "100",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        color: "#ffe6a0",
        fontSize: "clamp(30px, 6vw, 64px)",
        fontWeight: "900",
        letterSpacing: "8px",
        textAlign: "center",
        textShadow: [
            "0 0 8px #ff9d32",
            "0 0 20px #ff6b00",
            "0 4px 5px rgba(0,0,0,0.9)"
        ].join(","),
        background: "rgba(0, 0, 0, 0.28)",
        opacity: "0",
        transform: "scale(1.5)",
        transition: "opacity 250ms ease, transform 250ms ease"
    });

    parent.appendChild(overlay);

    // Kích hoạt hiệu ứng xuất hiện.
    requestAnimationFrame(() => {
        overlay.style.opacity = "1";
        overlay.style.transform = "scale(1)";
    });

    return new Promise(resolve => {
        const timer = setTimeout(() => {
            overlay.style.opacity = "0";
            overlay.style.transform = "scale(0.8)";

            setTimeout(() => {
                overlay.remove();

                if (previousPosition) {
                    parent.style.position = previousPosition;
                } else if (getComputedStyle(parent).position === "relative") {
                    parent.style.position = "";
                }

                resolve();
            }, 250);
        }, 1750);

        // Tổng thời gian từ lúc xuất hiện đến khi hoàn tất khoảng 2 giây.
    });
}



async function playBattleAnimation(battle) {
    const c = battleCanvasController;

    prepareCanvasBattle(battle);

    const speedButton = $("#battle-speed-btn");
    const skipButton = $("#battle-skip-btn");
    const backButton = $("#battle-back-btn");

    if (speedButton) {
        speedButton.textContent = `Tốc độ ×${c.speed}`;

        speedButton.onclick = () => {
            c.speed = c.speed === 1 ? 2 : c.speed === 2 ? 3 : 1;
            speedButton.textContent = `Tốc độ ×${c.speed}`;
        };
    }

    if (skipButton) {
        skipButton.onclick = () => {
            c.skipped = true;

            clearTimeout(c.timer);
            cancelAnimationFrame(c.animationFrame);

            c.units.forEach(unit => {
                const source = unit._battleSide === "player"
                    ? (battle.playerTeam || [])
                    : (battle.enemyTeam || []);

                const original = source[unit._battleIndex];

                if (original) {
                    unit._battleHp = getBattleUnitHp(original);
                    unit._battleAlive = getBattleUnitAlive(original);
                }
            });

            drawBattleCanvas();
        };
    }

    if (backButton) {
        backButton.onclick = () => {
            c.skipped = true;
            c.running = false;

            clearTimeout(c.timer);
            cancelAnimationFrame(c.animationFrame);

            $("#battle-screen")?.classList.add("hidden");

        };
    }

    // Gom các action có cùng castId thành một lần thi triển.
    const castGroups = new Map();

    c.actions.forEach((action, index) => {
        // Không có castId thì giữ action riêng.
        const key = action.castId != null && action.castId !== ""
            ? `cast:${action.castId}`
            : `action:${index}`;

        if (!castGroups.has(key)) {
            castGroups.set(key, []);
        }

        castGroups.get(key).push(action);
    });

    const groupedActions = Array.from(castGroups.values());

    // Đếm số lần thi triển, không phải số mục tiêu.
    c.actionIndex = 0;
    c.skipped = false;
    c.running = true;

    try {
        // Vẽ đội hình trước khi hiện chữ khai chiến.
        drawBattleCanvas();

        // Chờ hiệu ứng khai chiến hoàn tất.
        await showBattleStartOverlay();

        // Nếu người chơi đã bỏ qua hoặc quay lại trong lúc chờ,
        // không tiếp tục chạy các animation đòn đánh.
        if (c.skipped) {
            return;
        }

        startBattleCanvasLoop();


        while (
            c.actionIndex < groupedActions.length &&
            !c.skipped
            ) {
            const actionGroup = groupedActions[c.actionIndex];

            // Tướng thực hiện hành động.
            await playOneBattleAction(actionGroup);

            c.actionIndex++;

            // Chờ 1 giây rồi mới đến lượt hành động tiếp theo.
            if (
                c.actionIndex < groupedActions.length &&
                !c.skipped
            ) {
                await battleSleep(1000);
            }
        }

    } finally {
        c.running = false;

        clearTimeout(c.timer);
        cancelAnimationFrame(c.animationFrame);

        c.lastAttack = null;
        drawBattleCanvas();
    }

    const caption = $("#battle-action-caption");
    const currentAction = $("#battle-current-action");
    const turnLabel = $("#battle-turn-label");

    if (caption) {
        caption.textContent = c.skipped
            ? "Trận chiến đã kết thúc"
            : "Trận chiến kết thúc";
    }

    if (currentAction) {
        currentAction.textContent =
            `Kết quả: ${battle.result || "Đã kết thúc"} · ${formatNumber(battle.turns ?? 0)} lượt`;
    }

    if (turnLabel) {
        turnLabel.textContent = "Chiến đấu hoàn tất";
    }
}



function renderBattleUnit(unit, side) {
    const hp = Math.max(0, Number(unit.hp ?? 0));
    const maxHp = Math.max(1, Number(unit.maxHp ?? 1));
    const hpPercent = Math.min(100, (hp / maxHp) * 100);
    const alive = unit.alive !== false && hp > 0;
    const shield = Math.max(0, Number(unit.shield ?? 0));

    const statuses = [];

    if (Number(unit.stunRemaining ?? 0) > 0) {
        statuses.push(`💫 Choáng ${unit.stunRemaining}`);
    }

    if (Number(unit.attackBuffRemaining ?? 0) > 0) {
        statuses.push(`⚔️ Tăng công ${unit.attackBuffRemaining}`);
    }

    if (Number(unit.defenseBuffRemaining ?? 0) > 0) {
        statuses.push(`🛡️ Tăng thủ ${unit.defenseBuffRemaining}`);
    }

    return `
        <article class="battle-unit ${side} ${alive ? "" : "defeated"}">
            <div class="battle-unit-avatar">
                ${alive ? "⚔" : "☠"}
            </div>

            <div class="battle-unit-info">
                <div class="battle-unit-heading">
                    <strong>${escapeHtml(unit.heroName || unit.heroCode || "Tướng")}</strong>
                    <span class="battle-unit-slot">Vị trí ${escapeHtml(unit.slotNo ?? "-")}</span>
                </div>

                <div class="battle-hp-track">
                    <div
                        class="battle-hp-fill"
                        style="width: ${hpPercent}%"
                    ></div>
                </div>

                <div class="battle-unit-numbers">
                    <span>HP ${formatNumber(hp)} / ${formatNumber(maxHp)}</span>
                    ${shield > 0 ? `<span>🛡 ${formatNumber(shield)}</span>` : ""}
                </div>

                <div class="battle-unit-status">
                    ${statuses.map(status => `<span>${escapeHtml(status)}</span>`).join("")}
                </div>
            </div>
        </article>
    `;
}

function renderBattleResult(battle) {
    const content = $("#battle-result-content");

    if (!content) return;

    const players = Array.isArray(battle.playerTeam) ? battle.playerTeam : [];
    const enemies = Array.isArray(battle.enemyTeam) ? battle.enemyTeam : [];
    const actions = Array.isArray(battle.actions) ? battle.actions : [];

    const resultConfig = {
        WIN: { title: "CHIẾN THẮNG", icon: "🏆", css: "win" },
        LOSE: { title: "THẤT BẠI", icon: "💀", css: "lose" },
        DRAW: { title: "HÒA TRẬN", icon: "⚖️", css: "draw" },
    };

    const result = resultConfig[battle.result] || {
        title: battle.result || "KẾT THÚC",
        icon: "⚔️",
        css: "draw",
    };

    const orderedActions = [...actions].sort((a, b) =>
        Number(a.turnNo ?? 0) - Number(b.turnNo ?? 0)
        || Number(a.actionOrder ?? 0) - Number(b.actionOrder ?? 0)
    );

    content.innerHTML = `
        <section class="battle-arena">
            <div class="battle-result-banner ${result.css}">
                <span class="battle-result-icon">${result.icon}</span>
                <div>
                    <h2>${result.title}</h2>
                    <p>
                        ${escapeHtml(battle.stageName || "Chiến trường")}
                        · ${formatNumber(battle.turns ?? 0)} lượt
                    </p>
                </div>
            </div>

            <div class="battle-teams">
                <section class="battle-team player-team">
                    <h3>🟦 PHE CỦA MÀY</h3>
                    <div class="battle-unit-list">
                        ${players.map(unit => renderBattleUnit(unit, "player")).join("")}
                    </div>
                </section>

                <div class="battle-vs">VS</div>

                <section class="battle-team enemy-team">
                    <h3>🟥 KẺ ĐỊCH</h3>
                    <div class="battle-unit-list">
                        ${enemies.map(unit => renderBattleUnit(unit, "enemy")).join("")}
                    </div>
                </section>
            </div>

            <section class="battle-log-section">
                <h3>📜 Diễn biến trận đấu</h3>

                ${
        orderedActions.length
            ? `<div class="battle-log">
                            ${orderedActions.map(action => `
                                <div class="battle-log-entry">
                                    <span class="battle-log-turn">
                                        Lượt ${formatNumber(action.turnNo)}
                                    </span>
                                    <div class="battle-log-message">
                                        <strong>
                                            ${escapeHtml(action.actorName || action.actorCode || "Tướng")}
                                        </strong>
                                        <p>${escapeHtml(action.message || "Đã thực hiện hành động.")}</p>
                                        ${
                Number(action.damage ?? 0) > 0
                    ? `<span class="battle-damage">-${formatNumber(action.damage)} HP</span>`
                    : ""
            }
                                    </div>
                                </div>
                            `).join("")}
                        </div>`
            : `<p class="battle-log-empty">Trận đấu không có hành động được ghi nhận.</p>`
    }
            </section>

            <div class="battle-footer">
                <button
                    type="button"
                    class="btn btn-primary"
                    id="battle-play-again"
                >
                    ⚔️ Đánh lại
                </button>

                <button
                    type="button"
                    class="btn btn-secondary"
                    id="refresh-after-battle"
                >
                    Trở về
                </button>
            </div>
        </section>
    `;

    $("#battle-play-again")?.addEventListener("click", () => {
        const stage = state.stages.find(
            item => String(item.id) === String(battle.stageId)
        );

        if (stage) {
            handleEnterStage(stage);
        } else {
            showToast("Không tìm thấy dữ liệu ải để đánh lại.", "error");
        }
    });

    $("#refresh-after-battle")?.addEventListener("click", async () => {
        $("#battle-screen")?.classList.add("hidden");
        closeModal("#battle-modal");
        await refreshApplicationData();
    });
}


/* =========================================================
 * HEROES / FORMATION / INVENTORY
 *
 * Phần này hiện hiển thị trạng thái chờ kết nối API.
 * Chưa giả định cấu trúc JSON của các endpoint.
 * ========================================================= */

function renderPlaceholder(containerSelector, title, description) {
    const container = $(containerSelector);

    if (!container) {
        return;
    }

    container.innerHTML = `
        <div class="empty-state">
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(description)}</p>
        </div>
    `;
}

function getElementName(element) {
    const names = {
        KIM: "Kim",
        MOC: "Mộc",
        THUY: "Thủy",
        HOA: "Hỏa",
        THO: "Thổ",
    };

    return names[element] || element || "Chưa rõ";
}

function getRoleName(role) {
    const names = {
        TANK: "Đỡ đòn",
        ASSASSIN: "Thích khách",
        SUPPORT: "Hỗ trợ",
        FIGHTER: "Đấu sĩ",
        CONTROL: "Khống chế",
        MAGE: "Pháp sư",
    };

    return names[role] || role || "Chưa rõ";
}

function getRarityClass(rarity) {
    const value = String(rarity || "R").toUpperCase();

    return ["R", "SR", "SSR", "UR"].includes(value)
        ? `rarity-${value.toLowerCase()}`
        : "rarity-default";
}

function showHeroDetail(hero) {
    const container = $("#battle-result-content");
    const title = $("#battle-result-title");

    if (title) {
        title.textContent = hero.name || "Chi tiết tướng";
    }

    if (container) {
        container.innerHTML = `
            <div class="hero-detail">
                <div class="hero-detail-header">
                    <span class="hero-detail-rarity ${getRarityClass(hero.rarity)}">
                        ${escapeHtml(hero.rarity || "R")}
                    </span>

                    <h2>${escapeHtml(hero.name || "Chưa đặt tên")}</h2>

                    <p>
                        ${escapeHtml(getElementName(hero.element))}
                        ·
                        ${escapeHtml(getRoleName(hero.role))}
                    </p>
                </div>

                <div class="hero-detail-stats">
                    <div>
                        <span>HP cơ bản</span>
                        <strong>${formatNumber(hero.baseHp)}</strong>
                    </div>

                    <div>
                        <span>Tấn công cơ bản</span>
                        <strong>${formatNumber(hero.baseAttack)}</strong>
                    </div>

                    <div>
                        <span>Tốc độ</span>
                        <strong>${formatNumber(hero.speed)}</strong>
                    </div>

                    <div>
                        <span>Tỷ lệ chí mạng</span>
                        <strong>${formatNumber(hero.critChance)}</strong>
                    </div>
                </div>
            </div>
        `;
    }

    openModal("#battle-modal");
}

function renderHeroes(heroes) {
    const container = $("#heroes-content");

    if (!container) {
        return;
    }

    if (!Array.isArray(heroes) || heroes.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>Chưa có tướng</h3>
                <p>Tài khoản hiện chưa có tướng để hiển thị.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div class="hero-collection-header">
            <div>
                <h2>Bộ sưu tập tướng</h2>
                <p>Đang sở hữu ${heroes.length} tướng</p>
            </div>
        </div>

        <div class="hero-collection-grid">
            ${heroes.map((hero, index) => {
        const rarity = String(hero.rarity || "R").toUpperCase();
        const rarityClass = getRarityClass(rarity);

        return `
                    <button
                        type="button"
                        class="hero-card ${rarityClass}"
                        data-hero-index="${index}"
                    >
                        <div class="hero-card-art">
                            <span class="hero-element">
                                ${escapeHtml(getElementName(hero.element))}
                            </span>

                            <span class="hero-rarity">
                                ${escapeHtml(rarity)}
                            </span>

                            <div class="hero-card-placeholder">
                                <span>✦</span>
                            </div>
                        </div>

                        <div class="hero-card-info">
                            <h3>${escapeHtml(hero.name || "Chưa đặt tên")}</h3>

                            <p>${escapeHtml(getRoleName(hero.role))}</p>

                            <div class="hero-card-stats">
                                <span>HP ${formatNumber(hero.baseHp)}</span>
                                <span>ATK ${formatNumber(hero.baseAttack)}</span>
                            </div>
                        </div>
                    </button>
                `;
    }).join("")}
        </div>
    `;

    container.querySelectorAll("[data-hero-index]").forEach((button) => {
        button.addEventListener("click", () => {
            const index = Number(button.dataset.heroIndex);
            const hero = heroes[index];

            if (hero) {
                showHeroDetail(hero);
            }
        });
    });
}

async function loadHeroes() {
    const container = $("#heroes-content");

    if (container) {
        container.innerHTML = `
            <div class="loading-state">
                Đang tải danh sách tướng...
            </div>
        `;
    }

    try {
        const response = await apiRequest("/api/player/heroes");

        state.heroes = normalizeArray(response);

        console.log("Số tướng sở hữu:", state.heroes.length);
        console.log("Dữ liệu tướng:", state.heroes);

        renderHeroes(state.heroes);
    } catch (error) {
        console.error("Không tải được danh sách tướng:", error);

        if (container) {
            container.innerHTML = `
                <div class="empty-state">
                    <h3>Không tải được danh sách tướng</h3>
                    <p>${escapeHtml(error.message)}</p>

                    <button
                        type="button"
                        class="btn btn-primary"
                        id="retry-load-heroes"
                    >
                        Thử lại
                    </button>
                </div>
            `;

            $("#retry-load-heroes")?.addEventListener("click", loadHeroes);
        }
    }
}


const FORMATION_MAX_HEROES = 5;

let activeFormationSlot = null;

function getPlayerHeroId(hero) {
    return String(hero.playerHeroId);
}


async function loadFormation() {
    const container = $("#formation-content");
    if (!container) return;

    if (!state.token) {
        renderPlaceholder(
            "#formation-content",
            "Chưa đăng nhập",
            "Đăng nhập để tải và lưu đội hình."
        );
        return;
    }

    container.innerHTML = `
        <div class="loading-state">Đang tải đội hình...</div>
    `;

    try {
        const [heroesResponse, formationResponse] = await Promise.all([
            apiRequest("/api/player/heroes"),
            apiRequest("/api/player/formation"),
        ]);

        state.heroes = normalizeArray(heroesResponse);

        const slots = Array(9).fill(null);
        const usedHeroIds = new Set();

        normalizeArray(formationResponse).forEach(item => {
            const slotNo = Number(item.slotNo);
            const playerHeroId = String(item.playerHeroId ?? "");

            if (
                !Number.isInteger(slotNo) ||
                slotNo < 1 ||
                slotNo > 9 ||
                !playerHeroId ||
                usedHeroIds.has(playerHeroId) ||
                slots.filter(id => id != null).length >= FORMATION_MAX_HEROES
            ) {
                return;
            }

            const ownedHero = state.heroes.find(
                hero => getPlayerHeroId(hero) === playerHeroId
            );

            if (!ownedHero) return;

            slots[slotNo - 1] = playerHeroId;
            usedHeroIds.add(playerHeroId);
        });

        state.formation = slots;
        activeFormationSlot = null;

        renderFormation();
    } catch (error) {
        console.error("Không tải được đội hình:", error);

        container.innerHTML = `
            <div class="empty-state">
                <h3>Không tải được đội hình</h3>
                <p>${escapeHtml(error.message)}</p>
                <button
                    type="button"
                    class="btn btn-primary"
                    id="retry-load-formation"
                >
                    Thử lại
                </button>
            </div>
        `;

        $("#retry-load-formation")?.addEventListener("click", loadFormation);
    }
}


function renderFormation() {
    const container = $("#formation-content");
    if (!container) return;

    const formation = Array.isArray(state.formation)
        ? state.formation
        : Array(9).fill(null);

    const selectedCount = formation.filter(id => id != null).length;
    const selectedIds = new Set(
        formation.filter(id => id != null).map(String)
    );

    const slotsHtml = Array.from({ length: 9 }, (_, index) => {
        const heroId = formation[index];
        const hero = heroId == null
            ? null
            : state.heroes.find(
                item => getPlayerHeroId(item) === String(heroId)
            );

        const isBattleSlot = index < FORMATION_MAX_HEROES;


        if (!hero) {
            return `
                <button
                    class="formation-slot empty"
                    type="button"
                    data-formation-slot="${index}"
                >
                    <span class="formation-slot-number">${index + 1}</span>
                    <span class="formation-plus">+</span>
                    <span class="formation-slot-label">Chọn tướng</span>
                </button>
            `;
        }

        return `
            <button
                class="formation-slot occupied ${getRarityClass(hero.rarity)}"
                type="button"
                data-remove-slot="${index}"
                title="Bấm để bỏ ${escapeHtml(hero.name)} khỏi đội hình"
            >
                <span class="formation-slot-number">${index + 1}</span>
                <span class="formation-hero-element">
                    ${escapeHtml(getElementName(hero.element))}
                </span>
                <strong class="formation-hero-name">
                    ${escapeHtml(hero.name)}
                </strong>
                <span class="formation-hero-role">
                    ${escapeHtml(getRoleName(hero.role))}
                </span>
                <span class="formation-remove-hint">Bấm để bỏ tướng</span>
            </button>
        `;
    }).join("");

    const availableHeroes = state.heroes.map(hero => {
        const id = getPlayerHeroId(hero);
        const isSelected = selectedIds.has(id);

        return `
            <button
                class="formation-hero-option ${isSelected ? "selected" : ""}"
                type="button"
                data-select-hero="${escapeHtml(id)}"
                ${isSelected || selectedCount >= FORMATION_MAX_HEROES
            ? "disabled"
            : ""}
            >
                <span class="formation-option-rarity ${getRarityClass(hero.rarity)}">
                    ${escapeHtml(hero.rarity || "R")}
                </span>
                <strong>${escapeHtml(hero.name)}</strong>
                <span>${escapeHtml(getElementName(hero.element))}</span>
                <span>${escapeHtml(getRoleName(hero.role))}</span>
                ${isSelected
            ? '<span class="formation-option-status">Đã vào đội</span>'
            : ""}
            </button>
        `;
    }).join("");

    container.innerHTML = `
        <div class="formation-layout">
            <section class="formation-board-panel">
                <div class="formation-panel-heading">
                    <div>
                        <span class="eyebrow">BÀY BINH BỐ TRẬN</span>
                        <h3>Đội hình xuất chiến</h3>
                    </div>
                    <span class="formation-count">${selectedCount}/5 tướng</span>
                </div>

                <p class="formation-tip">
                    Chọn ô trống rồi chọn tướng bên dưới.
                    Bấm vào ô có tướng để gỡ tướng.
                </p>

                <div class="formation-grid">
                    ${slotsHtml}
                </div>

                <div class="formation-actions">
                    <button
                        class="button button-outline"
                        type="button"
                        id="formation-clear"
                    >
                        Xóa đội hình
                    </button>

                    <button
                        class="btn btn-primary"
                        type="button"
                        id="formation-save"
                        ${state.savingFormation ? "disabled" : ""}
                    >
                        ${state.savingFormation
        ? "Đang lưu..."
        : "Lưu đội hình"}
                    </button>
                </div>
            </section>

            <section class="formation-roster-panel">
                <div class="formation-panel-heading">
                    <div>
                        <span class="eyebrow">TƯỚNG SỞ HỮU</span>
                        <h3>Chọn tướng</h3>
                    </div>
                    <span>${state.heroes.length} tướng</span>
                </div>

                <div class="formation-roster">
                    ${availableHeroes || "<p>Chưa có tướng nào.</p>"}
                </div>
            </section>
        </div>
    `;

    bindFormationEvents();
}

function bindFormationEvents() {
    const container = $("#formation-content");
    if (!container) return;

    container.querySelectorAll("[data-formation-slot]").forEach(button => {
        button.addEventListener("click", () => {
            activeFormationSlot = Number(button.dataset.formationSlot);

            container.querySelectorAll(".formation-slot")
                .forEach(slot => slot.classList.remove("target-slot"));

            button.classList.add("target-slot");

            showToast("Chọn một tướng trong danh sách bên dưới.");
        });
    });

    container.querySelectorAll("[data-remove-slot]").forEach(button => {
        button.addEventListener("click", () => {
            const index = Number(button.dataset.removeSlot);

            state.formation[index] = null;
            activeFormationSlot = index;

            renderFormation();
        });
    });


    container.querySelectorAll("[data-select-hero]").forEach(button => {
        button.addEventListener("click", () => {
            const heroId = String(button.dataset.selectHero);

            if (state.formation.some(id => id != null && String(id) === heroId)) {
                showToast("Tướng này đã có trong đội hình.");
                return;
            }

            const selectedCount = state.formation.filter(id => id != null).length;

            if (selectedCount >= FORMATION_MAX_HEROES) {
                showToast("Đội hình chỉ được tối đa 5 tướng.");
                return;
            }

            let targetSlot = activeFormationSlot;

            // Nếu chưa chọn ô, hoặc ô đích không hợp lệ,
            // tìm ô trống đầu tiên trong cả 9 ô.
            if (
                targetSlot == null ||
                targetSlot < 0 ||
                targetSlot >= 9 ||
                state.formation[targetSlot] != null
            ) {
                targetSlot = state.formation.findIndex(id => id == null);
            }

            if (targetSlot < 0) {
                showToast("Đội hình đã hết chỗ trống.");
                return;
            }

            state.formation[targetSlot] = heroId;
            activeFormationSlot = null;

            renderFormation();
            showToast("Đã thêm tướng. Bấm Lưu đội hình để xác nhận.");
        });
    });


    $("#formation-clear")?.addEventListener("click", () => {
        state.formation = Array(9).fill(null);
        activeFormationSlot = null;

        renderFormation();
        showToast("Đội hình đã được xóa trên màn hình. Bấm Lưu đội hình để xác nhận.");
    });

    $("#formation-save")?.addEventListener("click", saveFormation);
}

async function saveFormation() {
    if (state.savingFormation) return;

    const selectedIds = state.formation
        .filter(id => id != null)
        .map(Number);

    if (new Set(selectedIds).size !== selectedIds.length) {
        showToast("Không thể chọn trùng tướng.", "error");
        return;
    }

    const ownedIds = new Set(
        state.heroes.map(hero => Number(hero.playerHeroId))
    );

    if (selectedIds.some(id => !Number.isInteger(id) || !ownedIds.has(id))) {
        showToast("Có tướng không thuộc tài khoản hiện tại.", "error");
        return;
    }

    const payload = {
        slots: state.formation
            .map((playerHeroId, index) => ({
                slotNo: index + 1,
                playerHeroId: playerHeroId == null
                    ? null
                    : Number(playerHeroId),
            }))
            .filter(slot => slot.playerHeroId != null),
    };

    state.savingFormation = true;
    renderFormation();

    try {
        await apiRequest("/api/player/formation", {
            method: "PUT",
            body: JSON.stringify(payload),
        });

        showToast("Đã lưu đội hình lên máy chủ.", "success");

        // Đọc lại dữ liệu chính thức từ backend.
        const response = await apiRequest("/api/player/formation");
        const slots = Array(9).fill(null);

        normalizeArray(response).forEach(item => {
            const slotNo = Number(item.slotNo);
            const playerHeroId = String(item.playerHeroId ?? "");

            if (
                slotNo < 1 ||
                slotNo > 9 ||
                !playerHeroId
            ) {
                return;
            }

            const ownedHero = state.heroes.find(
                hero => getPlayerHeroId(hero) === playerHeroId
            );

            if (ownedHero) {
                slots[slotNo - 1] = playerHeroId;
            }
        });

        state.formation = slots;
    } catch (error) {
        console.error("Lỗi lưu đội hình:", error);
        showToast("Lưu đội hình thất bại: " + error.message, "error");
    } finally {
        state.savingFormation = false;
        renderFormation();
    }
}



/**
 * Lấy tên tướng để hiển thị.
 * DTO có thể chứa thông tin tướng trong object hero lồng nhau,
 * hoặc trả trực tiếp name.
 */


/**
 * Hiển thị 9 vị trí đội hình.
 * Tối đa 5 vị trí được chọn tướng.
 */


/**
 * Gửi đội hình lên backend.
 *
 * playerHeroId phải là ID bản ghi trong bảng player_hero,
 * không phải ID của bảng hero.
 */




async function loadInventory() {
    renderPlaceholder(
        "#inventory-content",
        "Túi đồ",
        "Phần túi đồ sẽ được nối với API inventory ở phần tiếp theo."
    );
}

/* =========================================================
 * HOME BUTTONS / REFRESH
 * ========================================================= */

function bindNavigationEvents() {
    $all(".nav-item[data-view]").forEach((button) => {
        button.addEventListener("click", () => {
            navigateTo(button.dataset.view);
        });
    });

    $all("[data-go]").forEach((button) => {
        button.addEventListener("click", () => {
            navigateTo(button.dataset.go);
        });
    });

    $("#refresh-campaign")?.addEventListener("click", () => {
        loadCampaign();
    });


}

/* =========================================================
 * APPLICATION INITIALIZATION
 * ========================================================= */

async function refreshApplicationData() {
    const connected = await checkBackend();

    if (!connected) {
        showToast(
            `Không kết nối được backend tại ${state.apiBase}`,
            "error"
        );
        return;
    }

    if (!state.token) {
        state.player = null;
        renderPlayerInfo();
        openAuthModal("login");
        return;
    }

    await loadPlayerInfo();

    if (state.currentView === "campaign") {
        await loadCampaign();
    } else if (state.currentView === "heroes") {
        await loadHeroes();
    } else if (state.currentView === "formation") {
        await loadFormation();
    } else if (state.currentView === "inventory") {
        await loadInventory();
    }
}

/* =========================================================
 * AUTHENTICATION
 * ========================================================= */

function setAuthMessage(message, type = "") {
    const element = $("#auth-message");

    if (!element) return;

    element.textContent = message;
    element.className = "auth-message";

    if (type) {
        element.classList.add(type);
    }
}

function switchAuthTab(tab) {
    const isLogin = tab === "login";

    $("#login-form").hidden = !isLogin;
    $("#register-form").hidden = isLogin;

    $all("[data-auth-tab]").forEach((button) => {
        button.classList.toggle(
            "active",
            button.dataset.authTab === tab
        );
    });

    setAuthMessage("");
}

function openAuthModal(tab = "login") {
    switchAuthTab(tab);
    openModal("#auth-modal");
}

async function saveAuthResponse(data) {
    if (!data?.token) {
        throw new Error("Không nhận được token từ máy chủ.");
    }

    state.token = data.token;
    localStorage.setItem(CONFIG.jwtKey, data.token);

    if (data.displayName) {
        localStorage.setItem("ntck_display_name", data.displayName);
    }

    if (data.playerId != null) {
        localStorage.setItem("ntck_player_id", String(data.playerId));
    }

    // Đóng popup ngay khi xác thực thành công.
    closeModal("#auth-modal");

    // Cập nhật giao diện đăng nhập.
    state.player = null;

    await loadPlayerInfo();
    await refreshApplicationData();
}

function getApiErrorMessage(error) {
    return error?.message || "Đã xảy ra lỗi, vui lòng thử lại.";
}

function bindAuthEvents() {
    $all("[data-auth-tab]").forEach((button) => {
        button.addEventListener("click", () => {
            switchAuthTab(button.dataset.authTab);
        });
    });

    $("#close-auth-modal")?.addEventListener("click", () => {
        closeModal("#auth-modal");
    });

    $("#login-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();

        const form = event.currentTarget;
        const submitButton = form.querySelector('[type="submit"]');

        const username = $("#login-username").value.trim();
        const password = $("#login-password").value;

        submitButton.disabled = true;
        setAuthMessage("Đang đăng nhập...");

        try {
            const auth = await apiRequest("/api/auth/login", {
                method: "POST",
                body: JSON.stringify({
                    username,
                    password,
                }),
            });

            await saveAuthResponse(auth);

            setAuthMessage("Đăng nhập thành công!", "success");

            showToast(
                `Chào mừng ${auth.displayName || auth.username}!`,
                "success"
            );
        } catch (error) {
            console.error("Đăng nhập thất bại:", error);

            setAuthMessage(
                getApiErrorMessage(error),
                "error"
            );
        } finally {
            submitButton.disabled = false;
        }
    });

    $("#register-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();

        const form = event.currentTarget;
        const submitButton = form.querySelector('[type="submit"]');

        const username = $("#register-username").value.trim();
        const displayName = $("#register-display-name").value.trim();
        const email = $("#register-email").value.trim();
        const password = $("#register-password").value;

        const payload = {
            username,
            password,
            displayName,
        };

        if (email) {
            payload.email = email;
        }

        submitButton.disabled = true;
        setAuthMessage("Đang tạo tài khoản...");

        try {
            const auth = await apiRequest("/api/auth/register", {
                method: "POST",
                body: JSON.stringify(payload),
            });

            await saveAuthResponse(auth);

            setAuthMessage("Tạo tài khoản thành công!", "success");

            showToast(
                "Chào mừng đến với Nghịch Thiên Chiến Ký!",
                "success"
            );
        } catch (error) {
            console.error("Đăng ký thất bại:", error);

            setAuthMessage(
                getApiErrorMessage(error),
                "error"
            );
        } finally {
            submitButton.disabled = false;
        }
    });
}

function initializeApplication() {
    updateAuthButton();

    bindNavigationEvents();
    bindModalEvents();
    bindSettingsEvents();
    bindAuthEvents();

    renderPlayerInfo();
    navigateTo("home");

    refreshApplicationData();
}

$("#manual-close-auth")?.addEventListener("click", () => {
    const modal = document.getElementById("auth-modal");

    if (modal) {
        modal.classList.remove("open");
        modal.style.display = "none";
    }
});

document.addEventListener("DOMContentLoaded", initializeApplication);