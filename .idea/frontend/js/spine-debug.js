
(function () {
    "use strict";

    function startSpineDebug() {
        const panel = document.createElement("div");

        Object.assign(panel.style, {
            position: "fixed",
            top: "10px",
            right: "10px",
            width: "420px",
            maxHeight: "75vh",
            overflow: "auto",
            padding: "12px",
            background: "rgba(0,0,0,.94)",
            color: "#00ff88",
            border: "2px solid #00ff88",
            borderRadius: "8px",
            zIndex: "999999",
            font: "12px/1.5 monospace",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere"
        });

        panel.id = "spine-debug-panel";

        const heading = document.createElement("div");
        heading.textContent = "SPINE DEBUG LOG";
        heading.style.cssText =
            "font-weight:bold;color:yellow;margin-bottom:8px";

        const output = document.createElement("pre");
        output.style.margin = "0";

        const close = document.createElement("button");
        close.textContent = "Đóng";
        close.style.cssText = "margin-bottom:8px;cursor:pointer";
        close.onclick = () => panel.remove();

        panel.append(heading, close, output);
        document.body.appendChild(panel);

        function log(title, value) {
            const message = title + ": " + value;
            console.log("[SPINE DEBUG]", message);
            output.textContent += message + "\n";
        }

        function inspect() {
            const manager = window.SpineCharacterManager;
            const canvas = document.getElementById("battle-spine-canvas");
            const stage = document.getElementById("spine-debug-stage");

            output.textContent = "";

            log("Runtime", typeof window.spine);
            log("Manager", typeof manager);
            log("Stage", !!stage);
            log("Canvas", !!canvas);

            if (canvas) {
                const rect = canvas.getBoundingClientRect();
                log("Canvas size", rect.width + " x " + rect.height);
                log("Canvas display", getComputedStyle(canvas).display);
                log("Canvas visibility", getComputedStyle(canvas).visibility);
                log("Canvas opacity", getComputedStyle(canvas).opacity);

                try {
                    log("WebGL context", !!(
                        canvas.getContext("webgl") ||
                        canvas.getContext("experimental-webgl")
                    ));
                } catch (e) {
                    log("WebGL error", e.message);
                }
            }

            if (!manager) {
                log("ERROR", "window.SpineCharacterManager không tồn tại");
                return;
            }

            log("Initialized", manager.initialized);
            log("Loading", manager.loading);
            log("Loaded", manager.loaded);
            log("GL", !!manager.gl);
            log("Renderer", !!manager.renderer);
            log("AssetManager", !!manager.assetManager);
            log("Skeleton", !!manager.skeleton);
            log("SkeletonData", !!manager.skeletonData);
            log("AnimationState", !!manager.animationState);
            log("Current animation", manager.currentAnimation);

            if (typeof manager.getStatus === "function") {
                try {
                    log("getStatus", JSON.stringify(manager.getStatus()));
                } catch (e) {
                    log("getStatus error", e.message);
                }
            }

            if (manager.assetManager) {
                try {
                    log("Loading complete", manager.assetManager.isLoadingComplete());
                    log("Has errors", manager.assetManager.hasErrors?.());
                } catch (e) {
                    log("AssetManager error", e.message);
                }
            }
        }

        window.addEventListener("error", function (event) {
            log("JS ERROR", event.message + " | " +
                event.filename + ":" + event.lineno);
        });

        window.addEventListener("unhandledrejection", function (event) {
            log("PROMISE ERROR", event.reason?.stack || event.reason);
        });

        inspect();

        const refresh = document.createElement("button");
        refresh.textContent = "Làm mới log";
        refresh.style.cssText = "margin-top:8px;cursor:pointer";
        refresh.onclick = inspect;
        panel.appendChild(refresh);

        const copy = document.createElement("button");
        copy.textContent = "Copy log";
        copy.style.cssText = "margin:8px 0 0 8px;cursor:pointer";
        copy.onclick = async function () {
            try {
                await navigator.clipboard.writeText(output.textContent);
                copy.textContent = "Đã copy";
            } catch (e) {
                copy.textContent = "Không copy được";
            }
        };
        panel.appendChild(copy);

        console.log("[SPINE DEBUG] Debug panel initialized");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startSpineDebug);
    } else {
        startSpineDebug();
    }
})();
