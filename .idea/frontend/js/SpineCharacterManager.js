
"use strict";

window.SpineCharacterManager = {
    canvas: null,
    context: null,
    gl: null,
    renderer: null,
    assetManager: null,

    skeleton: null,
    skeletonData: null,
    animationState: null,
    animationStateData: null,

    animationFrame: 0,
    lastTime: 0,

    initialized: false,
    loading: false,
    loaded: false,
    initPromise: null,

    resizeHandler: null,
    resizeObserver: null,

    basePath: "./assets/spine/sanim_1001/",
    skeletonFile: "sanim_1001.json",
    atlasFile: "sanim_1001.atlas",
    textureFile: "sanim_1001.png",

    currentAnimation: null,

    /**
     * Khởi tạo Spine.
     */
    initialize() {
        if (this.loaded) {
            return Promise.resolve(true);
        }

        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = this.initializeInternal()
            .finally(() => {
                this.initPromise = null;
            });

        return this.initPromise;
    },

    /**
     * Khởi tạo WebGL và tải tài nguyên.
     */
    async initializeInternal() {
        if (!window.spine) {
            throw new Error("Spine Runtime chưa được nạp.");
        }

        const battleCanvas = document.getElementById("battle-canvas");

        if (!battleCanvas) {
            throw new Error("Không tìm thấy #battle-canvas.");
        }

        this.loading = true;

        try {
            this.createCanvas(battleCanvas);

            const spine = window.spine;
            const webgl = spine.webgl;

            if (!webgl) {
                throw new Error("Không tìm thấy Spine WebGL Runtime.");
            }

            this.context = new webgl.ManagedWebGLRenderingContext(
                this.canvas,
                { alpha: true }
            );

            this.gl = this.context.gl;

            if (!this.gl) {
                throw new Error("Không thể khởi tạo WebGL context.");
            }

            this.renderer = new webgl.SceneRenderer(
                this.canvas,
                this.context
            );

            this.assetManager = new webgl.AssetManager(
                this.context,
                this.basePath
            );

            this.loadAssets();

            await this.waitForAssets();

            // Chỉ tạo skeleton đúng một lần.
            this.createSkeleton();

            this.resize();

            this.resizeHandler = () => this.resize();

            window.addEventListener(
                "resize",
                this.resizeHandler
            );

            // Theo dõi kích thước battle-stage khi màn hình battle
            // chuyển từ hidden sang visible.
            if (typeof ResizeObserver !== "undefined") {
                this.resizeObserver = new ResizeObserver(() => {
                    this.resize();
                });

                this.resizeObserver.observe(this.canvas.parentElement);
            }

            this.loaded = true;
            this.initialized = true;
            this.loading = false;

            this.play("holdon", true);

            this.startRenderLoop();

            return true;

        } catch (error) {
            this.loading = false;
            this.loaded = false;
            this.initialized = false;

            this.destroy();

            throw error;
        }
    },

    /**
     * Tạo canvas WebGL đè lên battle-canvas.
     */
    createCanvas(battleCanvas) {
        if (!battleCanvas) {
            throw new Error("Không tìm thấy battle canvas.");
        }

        const battleStage = document.getElementById("battle-stage");

        if (!battleStage) {
            throw new Error("Không tìm thấy #battle-stage.");
        }

        this.canvas = document.getElementById("battle-spine-canvas");

        if (!this.canvas) {
            this.canvas = document.createElement("canvas");
            this.canvas.id = "battle-spine-canvas";
            battleStage.appendChild(this.canvas);
        } else if (this.canvas.parentElement !== battleStage) {
            battleStage.appendChild(this.canvas);
        }

        this.canvas.style.position = "absolute";
        this.canvas.style.left = "0";
        this.canvas.style.top = "0";
        this.canvas.style.width = "100%";
        this.canvas.style.height = "100%";
        this.canvas.style.display = "block";
        this.canvas.style.visibility = "visible";
        this.canvas.style.opacity = "1";
        this.canvas.style.pointerEvents = "none";
        this.canvas.style.zIndex = "2";

        battleStage.style.position = "relative";

        // Canvas có kích thước tối thiểu để tạo WebGL context,
        // kể cả khi battle-screen đang bị ẩn.
        const rect = battleStage.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        this.canvas.width = Math.max(
            1,
            Math.round(rect.width * dpr)
        );

        this.canvas.height = Math.max(
            1,
            Math.round(rect.height * dpr)
        );
    },

    /**
     * Tải tài nguyên Spine.
     */
    loadAssets() {
        this.assetManager.loadTexture(this.textureFile);
        this.assetManager.loadText(this.atlasFile);
        this.assetManager.loadText(this.skeletonFile);
    },

    /**
     * Chờ tài nguyên tải xong.
     */
    waitForAssets() {
        return new Promise((resolve, reject) => {
            const startedAt = performance.now();

            const check = () => {
                if (this.assetManager.isLoadingComplete()) {
                    resolve(true);
                    return;
                }

                if (performance.now() - startedAt > 20000) {
                    reject(
                        new Error("Hết thời gian chờ tải Spine assets.")
                    );
                    return;
                }

                requestAnimationFrame(check);
            };

            check();
        });
    },

    /**
     * Đọc JSON + Atlas và tạo Skeleton.
     *
     * Giữ nguyên cấu trúc skins object của JSON Spine 3.5.35.
     */
    createSkeleton() {
        const spine = window.spine;

        const atlasText = this.assetManager.get(this.atlasFile);
        const jsonText = this.assetManager.get(this.skeletonFile);

        if (!atlasText || !jsonText) {
            throw new Error("Không đọc được Spine JSON hoặc Atlas.");
        }

        const atlas = new spine.TextureAtlas(
            atlasText,
            path => this.assetManager.get(path)
        );

        const attachmentLoader = new spine.AtlasAttachmentLoader(atlas);

        const skeletonJson = new spine.SkeletonJson(
            attachmentLoader
        );

        const jsonData = typeof jsonText === "string"
            ? JSON.parse(jsonText)
            : jsonText;

        // Không chuyển skins object thành array.
        this.skeletonData = skeletonJson.readSkeletonData(jsonData);

        if (!this.skeletonData) {
            throw new Error("Không tạo được SkeletonData.");
        }

        this.skeleton = new spine.Skeleton(this.skeletonData);

        const defaultSkin = this.skeletonData.findSkin("default");

        if (defaultSkin) {
            this.skeleton.setSkin(defaultSkin);
        }

        this.skeleton.setToSetupPose();
        this.skeleton.updateWorldTransform();

        this.animationStateData = new spine.AnimationStateData(
            this.skeletonData
        );

        this.animationStateData.defaultMix = 0.15;

        this.animationState = new spine.AnimationState(
            this.animationStateData
        );

        this.currentAnimation = null;
    },

    /**
     * Phát animation.
     */
    play(animationName, loop = true) {
        if (!this.skeleton || !this.animationState) {
            return false;
        }

        const exists = this.skeletonData.animations.some(
            animation => animation.name === animationName
        );

        if (!exists) {
            return false;
        }

        if (this.currentAnimation === animationName) {
            return true;
        }

        this.currentAnimation = animationName;

        this.animationState.setAnimation(
            0,
            animationName,
            loop
        );

        return true;
    },

    /**
     * Thay đổi kích thước canvas và scale skeleton.
     */
    resize() {
        if (!this.canvas || !this.renderer || !this.gl) {
            return;
        }

        const parent = this.canvas.parentElement;

        if (!parent) {
            return;
        }

        const rect = parent.getBoundingClientRect();

        // Stage đang ẩn: đợi ResizeObserver gọi resize lại.
        if (rect.width <= 0 || rect.height <= 0) {
            return;
        }

        const dpr = Math.min(
            window.devicePixelRatio || 1,
            2
        );

        const width = Math.round(rect.width * dpr);
        const height = Math.round(rect.height * dpr);

        if (
            this.canvas.width !== width ||
            this.canvas.height !== height
        ) {
            this.canvas.width = width;
            this.canvas.height = height;
        }

        this.gl.viewport(
            0,
            0,
            this.canvas.width,
            this.canvas.height
        );

        this.renderer.resize(
            window.spine.webgl.ResizeMode.Fit
        );

        if (this.skeleton) {
            const skeletonWidth =
                this.skeletonData.width || 720;

            const skeletonHeight =
                this.skeletonData.height || 1280;

            const scale = Math.min(
                rect.width / skeletonWidth,
                rect.height / skeletonHeight
            );

            this.skeleton.scaleX = scale;
            this.skeleton.scaleY = scale;

            this.skeleton.x = 0;
            this.skeleton.y = 0;

            this.skeleton.updateWorldTransform();
        }
    },

    /**
     * Vòng lặp render Spine.
     */
    startRenderLoop() {
        cancelAnimationFrame(this.animationFrame);

        this.lastTime = 0;

        const render = now => {
            if (!this.loaded) {
                return;
            }

            if (!this.lastTime) {
                this.lastTime = now;
            }

            const delta = Math.min(
                0.05,
                (now - this.lastTime) / 1000
            );

            this.lastTime = now;

            this.animationState.update(delta);
            this.animationState.apply(this.skeleton);

            this.skeleton.updateWorldTransform();

            this.gl.clearColor(0, 0, 0, 0);

            this.gl.clear(
                this.gl.COLOR_BUFFER_BIT
            );

            this.renderer.begin();

            this.renderer.drawSkeleton(
                this.skeleton,
                false
            );

            this.renderer.end();

            this.animationFrame = requestAnimationFrame(render);
        };

        this.animationFrame = requestAnimationFrame(render);
    },

    /**
     * Dừng render và giải phóng trạng thái.
     */
    destroy() {
        this.loaded = false;
        this.loading = false;
        this.initialized = false;

        cancelAnimationFrame(this.animationFrame);

        this.animationFrame = 0;
        this.lastTime = 0;

        if (this.resizeHandler) {
            window.removeEventListener(
                "resize",
                this.resizeHandler
            );

            this.resizeHandler = null;
        }

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        if (this.gl) {
            this.gl.clearColor(0, 0, 0, 0);
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        }

        this.skeleton = null;
        this.skeletonData = null;

        this.animationState = null;
        this.animationStateData = null;

        this.currentAnimation = null;
    },

    /**
     * Lấy trạng thái Spine.
     */
    getStatus() {
        return {
            runtimeLoaded: !!window.spine,
            initialized: this.initialized,
            loading: this.loading,
            loaded: this.loaded,
            canvasExists: !!this.canvas,
            canvasWidth: this.canvas?.width || 0,
            canvasHeight: this.canvas?.height || 0,
            skeletonExists: !!this.skeleton,
            currentAnimation: this.currentAnimation
        };
    }
};
