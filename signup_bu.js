load("userdefs.js");
load("sbbsdefs.js");
load("frame.js");
load("event-timer.js");

/* ========================= constants ========================= */
const SCREEN_WIDTH = console.screen_columns;
const SCREEN_HEIGHT = console.screen_rows;
const MOD_DIR = '/sbbs/mods/future_signup/';
const SPRITE_META_FILE = MOD_DIR + "paperclip.sprite.json";
const DEFAULT_ATTR = WHITE | BG_BLUE;
const MIN_FRAME_INTERVAL_MS = 100;
const INPUT_POLL_INTERVAL = 75;
const TIMER_IDLE_DELAY = 25;
const MOUSE_TIMEOUT_MS = 30000;
const REACTION_DELAY_MS = 2500;
const ALIAS_MAX_LENGTH = 24;
const MIN_ANIMATION_TIMEOUT = 2000;
/* ============================================================= */
log("future_signup.js loaded, TEST_FLOW=" + (typeof TEST_FLOW !== "undefined" ? TEST_FLOW : "undefined"));
console.autoterm |= USER_MOUSE;
Frame.prototype.drawBorder = function (color) {
    var msg;
    var theColor = color;
    const sectionLength = Array.isArray(color) ? Math.round(this.width / color.length) : 0;
    this.pushxy();
    for (var y = 1; y <= this.height; y++) {
        for (var x = 1; x <= this.width; x++) {
            if (x > 1 && x < this.width && y > 1 && y < this.height) continue;
            this.gotoxy(x, y);
            if (y == 1 && x == 1) {
                msg = ascii(218);
            } else if (y == 1 && x == this.width) {
                msg = ascii(191);
            } else if (y == this.height && x == 1) {
                msg = ascii(192);
            } else if (y == this.height && x == this.width) {
                msg = ascii(217);
            } else if (x == 1 || x == this.width) {
                msg = ascii(179);
            } else {
                msg = ascii(196);
            }
            if (sectionLength) {
                if (x == 1) {
                    theColor = color[0];
                } else if (x % sectionLength == 0 && x < this.width) {
                    theColor = color[x / sectionLength];
                } else if (x == this.width) {
                    theColor = color[color.length - 1];
                }
            }
            this.putmsg(msg, theColor);
        }
    }
    this.popxy();
}

Frame.prototype.makeContentTransparent = function () {
    /*
        Convert interior cells that look like "background fill" into truly transparent cells so
        lower frames show through. Rules:
          - Skip border (outermost rectangle) entirely.
          - A cell is considered empty if char is undefined/space and attr background matches this.attr background.
          - We preserve any cell with a printable char or a different background (content).
        Implementation detail:
          Frame.setData(x,y,undefined,0,false) removes stored char/attr (makes transparent when frame.transparent=true).
    */
    try {
        var width = this.width || 0, height = this.height || 0;
        if (width <= 0 || height <= 0) { this.transparent = true; return; }
        // Determine this frame's background (low 4 bits of attr if standard Synchronet color encoding)
        var frameBg = (this.attr !== undefined && this.attr !== null) ? (this.attr & 0xF0) : null; // BG bits (assuming 0xF0 mask)
        for (var y = 2; y <= height - 1; y++) { // interior rows only
            for (var x = 2; x <= width - 1; x++) { // interior cols only
                // Peek existing cell if API available; fall back to heuristic blank replacement.
                var ch, attr;
                try {
                    if (typeof this.getData === 'function') {
                        var d = this.getData(x - 1, y - 1); // expect {ch,attr}
                        if (d) { ch = d.ch; attr = d.attr; }
                    }
                } catch (_) { }
                if (ch === undefined || ch === null) ch = ' ';
                var bgMatch = false;
                if (attr === undefined || attr === null) {
                    // If attr missing treat as same background
                    bgMatch = true;
                } else if (frameBg !== null) {
                    bgMatch = ((attr & 0xF0) === frameBg);
                }
                var looksEmpty = bgMatch && (ch === ' ' || ch === '' || ch === undefined);
                if (looksEmpty) {
                    try { this.clearData(x - 1, y - 1); } catch (_) { }
                }
            }
        }
        this.transparent = true;
        // Final cycle if available to refresh composed screen (callers may also cycle root)
        if (typeof this.cycle === 'function') try { this.cycle(); } catch (_) { }
    } catch (e) {
        try { log(LOG_WARNING, 'makeContentTransparent error: ' + e); } catch (_) { }
        this.transparent = true; // still enable transparency
    }
};

/* ========================= util helpers ========================= */
var _creationDone = false;

function createAccountFromSession() {
    if (_creationDone) return { ok: false, err: "Create already attempted" };

    // Validate before touching files
    if (!session.alias || !system.check_name(session.alias))
        return { ok: false, err: "Alias not allowed" };
    if (system.matchuser(session.alias))
        return { ok: false, err: "Alias already exists" };

    // 1) allocate the user slot
    var nu;
    try {
        nu = system.new_user(session.alias, client);
    } catch (e) {
        return { ok: false, err: "new_user() threw", detail: String(e) };
    }
    if (typeof nu === "number")
        return { ok: false, err: "new_user() failed", code: nu };

    try {
        // 2) make that record the *current* user (no login prompt)
        user.number = nu.number;   // <-- this is the key to avoid -100

        // 3) set fields on current user
        user.settings |= USER_ANSI;
        if (session.color === true) user.settings |= USER_COLOR;
        if (session.color === false) user.settings &= ~USER_COLOR;
        // ExASCII inverted bit: USER_NO_EXASCII means "broken"
        if (session.exascii === true) user.settings &= ~USER_NO_EXASCII;
        if (session.exascii === false) user.settings |= USER_NO_EXASCII;

        user.name = session.alias.substr(0, LEN_NAME);
        user.handle = session.alias.substr(0, LEN_HANDLE);
        user.netmail = session.email || "";
        user.gender = user.gender || ' ';

        user.security.level = system.newuser_level;
        user.security.exemptions = system.newuser_exemptions;
        user.security.flags1 = system.newuser_flags1;
        user.security.flags2 = system.newuser_flags2;
        user.security.flags3 = system.newuser_flags3;
        user.security.flags4 = system.newuser_flags4;
        user.security.restrictions = system.newuser_restrictions;
        user.security.credits = system.newuser_credits;
        user.security.minutes = system.newuser_minutes;
        user.security.password_date = time();
        user.command_shell = system.newuser_command_shell;
        user.security.expiration_date = system.newuser_expiration_days > 0
            ? time() + system.newuser_expiration_days * 24 * 60 * 60 : 0;

        if (session.password && session.password.length)
            user.security.password = session.password.toUpperCase();

        // 4) persist now that a valid user is selected
        bbs.user_sync();

        // 5) optional new-user event (comment out until stable if needed)
        bbs.user_event(EVENT_NEWUSER);
        bbs.user_sync();

        _creationDone = true;
        return { ok: true, number: user.number, alias: user.alias };
    } catch (err) {
        // best-effort rollback to avoid junk accounts
        try { user.comment = "signup failed: " + String(err); user.settings |= USER_DELETED; bbs.user_sync(); } catch (_) { }
        return { ok: false, err: "signup crashed", detail: String(err) };
    }
}
function clockMs() {
    if (typeof Date !== "undefined" && Date.now) return Date.now();
    if (typeof system !== "undefined" && typeof system.timer !== "undefined")
        return Math.floor(system.timer * (1000 / 18.2065)); // ~54.9254 ms per tick
    return Math.floor(time() * 1000);
}

function readTextFile(path) {
    var f = new File(path);
    if (!f.open("rb")) throw new Error("could not read \"" + path + "\": " + f.error);
    var content = f.read();
    f.close();
    return content;
}

function stripSauce(contents) {
    if (!contents || contents.length < 129) return contents;
    if (contents.substr(-128, 7) !== "SAUCE00") return contents;

    function charCodeFromEnd(offset) {
        return contents.charCodeAt(contents.length - offset);
    }

    var size = charCodeFromEnd(35);
    size = (size << 8) | charCodeFromEnd(36);
    size = (size << 8) | charCodeFromEnd(37);
    size = (size << 8) | charCodeFromEnd(38);

    if (size >= 0 && size <= contents.length) return contents.substr(0, size);
    return contents;
}

function dosAttrToSync(attrByte) {
    var fg = attrByte & 0x0F;
    var bg = (attrByte >> 4) & 0x07;
    var blink = (attrByte & 0x80) !== 0;

    var FG = [
        BLACK, BLUE, GREEN, CYAN, RED, MAGENTA, BROWN, LIGHTGRAY,
        DARKGRAY, LIGHTBLUE, LIGHTGREEN, LIGHTCYAN, LIGHTRED, LIGHTMAGENTA, YELLOW, WHITE
    ];
    var BG = [
        BG_BLACK, BG_BLUE, BG_GREEN, BG_CYAN, BG_RED, BG_MAGENTA, BG_BROWN, BG_LIGHTGRAY
    ];

    var attr = FG[fg] | BG[bg];
    if (blink && typeof BLINK !== "undefined") attr |= BLINK;
    return attr;
}

function sanitizeChar(ch) {
    var code = ch.charCodeAt(0);
    if (code === 0 || code === 9 || code === 10 || code === 13 || code === 27) return " ";
    return ch;
}

function loadSpriteDefinition(path) {
    var raw = readTextFile(path);
    var data = JSON.parse(raw);

    if (!data || typeof data !== "object") throw new Error("sprite metadata missing object");
    if (!Array.isArray(data.frameSize) || data.frameSize.length !== 2)
        throw new Error("sprite metadata frameSize must be [width,height]");
    if (typeof data.source !== "string" || !data.source.length)
        throw new Error("sprite metadata requires \"source\" string");
    if (!data.animations || typeof data.animations !== "object")
        throw new Error("sprite metadata missing \"animations\"");

    return data;
}

function resolveSpriteSource(def) {
    if (/^[A-Za-z]:\\/.test(def.source) || def.source.indexOf("/") === 0) return def.source;
    return def.source.indexOf("/") === -1 ? (MOD_DIR + def.source) : def.source;
}

function loadSpriteFrames(binPath, cols, rows) {
    var raw = stripSauce(readTextFile(binPath));
    var cellsPerFrame = cols * rows;
    var bytesPerFrame = null;
    var isCharAttr = false;

    function tryAdjust(len) {
        if (len % (cellsPerFrame * 2) === 0) {
            bytesPerFrame = cellsPerFrame * 2;
            isCharAttr = true;
            return true;
        }
        if (len % cellsPerFrame === 0) {
            bytesPerFrame = cellsPerFrame;
            isCharAttr = false;
            return true;
        }
        return false;
    }

    if (!tryAdjust(raw.length)) {
        if (tryAdjust(raw.length - 1)) {
            raw = raw.substr(0, raw.length - 1);
        } else {
            throw new Error(format("BIN size %lu does not align with %dx%d frames", raw.length, cols, rows));
        }
    }

    var totalFrames = raw.length / bytesPerFrame;
    var frames = [];
    var offset = 0;

    for (var fi = 0; fi < totalFrames; fi++) {
        var frame = new Array(rows);
        for (var r = 0; r < rows; r++) {
            var row = new Array(cols);
            for (var c = 0; c < cols; c++) {
                var ch = sanitizeChar(raw.charAt(offset++));
                var attr = DEFAULT_ATTR;
                if (isCharAttr) attr = dosAttrToSync(raw.charCodeAt(offset++));
                row[c] = { ch: ch, attr: attr };
            }
            frame[r] = row;
        }
        frames.push(frame);
    }

    return {
        frames: frames,
        hasColor: isCharAttr
    };
}

function drawFrameToPane(pane, frame) {
    pane.clear();
    for (var r = 0; r < frame.length; r++) {
        pane.gotoxy(1, 1 + r);
        var row = frame[r];
        for (var c = 0; c < row.length; c++) {
            var cell = row[c];
            pane.putmsg(cell.ch, cell.attr);
        }
    }
    pane.draw();
}

function buildAnimations(def, totalFrames) {
    var animations = {};
    var firstKey = null;

    for (var key in def.animations) {
        if (!def.animations.hasOwnProperty(key)) continue;
        var spec = def.animations[key];
        if (!spec || typeof spec !== "object")
            throw new Error("animation " + key + " must be an object");
        if (!Array.isArray(spec.frames) || spec.frames.length === 0)
            throw new Error("animation " + key + " needs non-empty frames array");

        var frames = [];
        for (var i = 0; i < spec.frames.length; i++) {
            var idx = parseInt(spec.frames[i], 10);
            if (isNaN(idx)) throw new Error("animation " + key + " frame index " + spec.frames[i] + " is not a number");
            if (idx < 0 || (totalFrames !== null && idx >= totalFrames))
                throw new Error("animation " + key + " references missing frame " + idx);
            frames.push(idx);
        }

        var speed = parseInt(spec.speed, 10);
        if (isNaN(speed) || speed <= 0) speed = 200;
        if (speed < MIN_FRAME_INTERVAL_MS) speed = MIN_FRAME_INTERVAL_MS;
        var loop = spec.loop !== false;

        animations[key] = {
            name: key,
            frames: frames,
            speed: speed,
            loop: loop
        };

        if (firstKey === null) firstKey = key;
    }

    return { map: animations, first: firstKey };
}

function SpriteAnimator(pane, frames, animations, defaultAnimation) {
    this.pane = pane;
    this.frames = frames;
    this.animations = animations;
    this.current = null;
    this.currentName = null;
    this.cursor = 0;
    this.nextTick = 0;
    this.defaultAnimation = defaultAnimation || null;
    this.pane.makeContentTransparent();
    this.pane.cycle();
}

SpriteAnimator.prototype.hasAnimation = function (name) {
    return this.animations.hasOwnProperty(name);
};

SpriteAnimator.prototype.play = function (name, now) {
    if (!this.animations.hasOwnProperty(name)) throw new Error("unknown animation " + name);
    var nowMs = now !== undefined ? now : clockMs();

    var anim = this.animations[name];
    this.current = anim;
    this.currentName = name;
    this.cursor = 0;
    this.nextTick = nowMs + anim.speed;
    this.renderCurrentFrame();
};

SpriteAnimator.prototype.ensure = function (name) {
    if (this.currentName !== name) this.play(name);
};

SpriteAnimator.prototype.renderCurrentFrame = function () {
    if (!this.current) return;
    var frameIndex = this.current.frames[Math.min(this.cursor, this.current.frames.length - 1)];
    drawFrameToPane(this.pane, this.frames[frameIndex]);
};

SpriteAnimator.prototype.step = function (now) {
    if (!this.current) return MIN_FRAME_INTERVAL_MS;
    var nowMs = now !== undefined ? now : clockMs();

    if (this.nextTick === 0) this.nextTick = nowMs + this.current.speed;
    if (nowMs < this.nextTick) return Math.max(MIN_FRAME_INTERVAL_MS, this.nextTick - nowMs);

    var advanced = false;
    while (nowMs >= this.nextTick) {
        if (this.current.frames.length > 1) {
            this.cursor++;
            if (this.cursor >= this.current.frames.length) {
                if (this.current.loop) {
                    this.cursor = 0;
                } else {
                    this.cursor = this.current.frames.length - 1;
                    this.nextTick = nowMs + this.current.speed;
                    advanced = true;
                    break;
                }
            }
        }
        this.nextTick += this.current.speed;
        advanced = true;
        if (!this.current.loop && this.cursor === this.current.frames.length - 1)
            break;
    }

    if (advanced) this.renderCurrentFrame();
    return Math.max(MIN_FRAME_INTERVAL_MS, this.nextTick - nowMs);
};

SpriteAnimator.prototype.idle = function () {
    if (this.defaultAnimation && this.animations.hasOwnProperty(this.defaultAnimation))
        this.ensure(this.defaultAnimation);
};

/* ========================= UI helpers ========================= */
function spaces(n) {
    return Array((n | 0) + 1).join(" ");
}

function repeat(count, ch) {
    count = count | 0;
    if (count <= 0) return "";
    if (typeof ch !== "string" || !ch.length) ch = " ";
    if (typeof String !== "undefined" && String.prototype && String.prototype.repeat)
        return ch.repeat(count);
    var out = "";
    while (count-- > 0) out += ch;
    return out;
}

function stripCtrlA(str) {
    return str.replace(/\x01./g, "");
}

function centerInWidth(text, width) {
    var raw = stripCtrlA(text);
    var pad = Math.max(0, ((width - raw.length) / 2) | 0);
    return spaces(pad) + text;
}

function wrapText(str, width) {
    var out = [], i = 0;
    while (i < str.length) {
        var chunk = str.substr(i, width);
        // try to break on space
        if (chunk.length === width && i + width < str.length) {
            var j = chunk.lastIndexOf(' ');
            if (j > 0) { chunk = chunk.substr(0, j); i += j + 1; } else { i += width; }
        } else {
            i += chunk.length;
        }
        out.push(chunk);
    }
    return out;
}

function centerLine(frame, text) {
    frame.clear();
    var usable = Math.max(1, frame.width - 4);
    var lines = wrapText(text, usable);
    var midY = Math.max(1, (frame.height / 2) | 0);
    var startY = Math.max(1, midY - ((lines.length - 1) / 2 | 0));
    for (var i = 0; i < lines.length && i < frame.height; i++) {
        var line = lines[i];
        var pad = Math.max(0, ((usable - stripCtrlA(line).length) / 2) | 0);
        frame.gotoxy(3 + pad, startY + i);
        frame.putmsg("\1n" + line);
    }
    frame.draw();
}

function centerMain(text, offsetY) {
    if (!offsetY) offsetY = 0;
    var padding = 10;
    var width = main.width - (padding * 2);
    var lines = parseInt(text.length / width) + 1;
    var availY = main.height - spritePane.height - 1;
    var centerY = availY / 2 - lines + offsetY;
    // main.clear();
    for (var i = 0; i < lines; i++) {
        var substr = text.substring(i * width, (i + 1) * width);
        var trimmed = substr.trim();
        if (!trimmed.length) {
            main.gotoxy(padding, centerY + i);
            continue;
        }
        var rawLen = stripCtrlA(trimmed).length;
        var linePad = ((width - rawLen) / 2) | 0;
        main.gotoxy(padding + linePad, centerY + i);
        main.putmsg(trimmed);
    }

}
function showTitle(message, hotspotSpecs) {
    message = "\1r" + system.name + " BOOTSTRAP USER \1n" + message;
    statePrompt.clear();
    statePrompt.gotoxy(1, 2);
    var line = centerInWidth(message, statePrompt.width);
    statePrompt.putmsg(line);
    statePrompt.drawBorder(YELLOW | BG_CYAN);
    statePrompt.draw();
    if (hotspotsSupported && hotspotSpecs && hotspotSpecs.length) {
        for (var i = 0; i < hotspotSpecs.length; i++) {
            var spec = hotspotSpecs[i];
            if (!spec || !spec.label || !spec.cmd) continue;
            var idx = line.indexOf(spec.label);
            if (idx >= 0) addHotspotForFrame(statePrompt, idx + 1, 2, spec.label.length, spec.cmd);
        }
    }
}

/* ========================= sprite bootstrap ========================= */
var spriteDef = loadSpriteDefinition(SPRITE_META_FILE);
var spriteSize = spriteDef.frameSize;
var spriteSourcePath = resolveSpriteSource(spriteDef);
var spriteData = loadSpriteFrames(spriteSourcePath, spriteSize[0], spriteSize[1]);
var animations = buildAnimations(spriteDef, spriteData.frames.length);

if (!animations.first)
    throw new Error("no animations defined in sprite metadata");

log(LOG_INFO, format("Loaded %u sprite frames (%s) from %s", spriteData.frames.length, spriteData.hasColor ? "with color" : "monochrome", spriteSourcePath));

var buttonInterval;
var seconds;
/* ========================= layout ========================= */
var root = new Frame(1, 1, SCREEN_WIDTH, SCREEN_HEIGHT, BG_BLACK | LIGHTGRAY);
var button; // will define later
var button2; // will define later
var statePromptHeight = 3;
var centeredContainer = new Frame(parseInt((SCREEN_WIDTH - 79) / 2) || 1, 1, 80, 24 || root.height, BG_LIGHTGRAY | BLACK, root);
log("created centered container at " + centeredContainer.x + "," + centeredContainer.y + " size " + centeredContainer.width + "x" + centeredContainer.height);
var statePrompt = new Frame(centeredContainer.x, 1, centeredContainer.width, 3, BG_CYAN | WHITE, centeredContainer);
var main = new Frame(centeredContainer.x, 4, centeredContainer.width, centeredContainer.height - statePromptHeight, BG_BLUE | WHITE, centeredContainer);
var spritePane = new Frame(centeredContainer.x + centeredContainer.width - 16, centeredContainer.height - 7, spriteSize[0], spriteSize[1], BG_GREEN | LIGHTGRAY, centeredContainer);
spritePane.transparent = true;
var speechBubbleWidth = centeredContainer.width / 2;
var speechBubble = new Frame(centeredContainer.x + speechBubbleWidth - 16, spritePane.y - 1, speechBubbleWidth, 5, BG_BLACK | BLACK, main);
var speechBubbleText = new Frame(speechBubble.x + 2, speechBubble.y + 1, speechBubble.width - 4, speechBubble.height - 2, BG_BLACK | YELLOW, speechBubble);
main.bottom();
spritePane.top();
root.cycle();
// TODO: can we prep the frames for transparency using sprite.setAttr or clearAttr on black cells?
var animator = new SpriteAnimator(spritePane, spriteData.frames, animations.map, animations.first);

var session = {
    mouse: null,
    color: null,
    exascii: null,
    backspace: false,
    alias: "",
    password: "",
    email: "",
    rulesAccepted: false,
    confirmed: false
};
var backspaceBuffer = "";
var backspaceStage = "type";
var aliasBuffer = "";
var passwordBuffer = "";
var passwordConfirmBuffer = "";
var emailBuffer = "";
var emailConfirmBuffer = "";

var hotspotsSupported = (typeof console.add_hotspot === "function" && typeof console.clear_hotspots === "function");

function resetSession() {
    session.mouse = null;
    session.color = null;
    session.exascii = null;
    session.backspace = false;
    session.alias = "";
    session.password = "";
    session.email = "";
    session.rulesAccepted = false;
    session.confirmed = false;
    backspaceBuffer = "";
    backspaceStage = "type";
    aliasBuffer = "";
    passwordBuffer = "";
    passwordConfirmBuffer = "";
    emailBuffer = "";
    emailConfirmBuffer = "";
}

/* ========================= state + timer management ========================= */
var timer = new Timer();
var animationEvent = null;
var inputEvent = null;
var stateEvents = [];
var pendingTransitionEvent = null;
var running = true;
var currentState = null;
var stateStarted = 0;

function clearHotspots() {
    if (hotspotsSupported) console.clear_hotspots();
}

function addHotspotForFrame(frame, cmd) {
    if (!hotspotsSupported) return;
    var absX = frame.x - 1;
    for (var row = frame.y; row < frame.y + frame.height; row++) {
        var absY = row - 1;
        console.add_hotspot(cmd, false, absX, absX + frame.width - 1, absY);
    }
}

function clearStateEvents() {
    for (var i = 0; i < stateEvents.length; i++) {
        stateEvents[i].abort = true;
    }
    stateEvents = [];
}

function scheduleStateEvent(delay, fn) {
    var ev = timer.addEvent(delay, false, fn);
    stateEvents.push(ev);
    return ev;
}

function chooseAnimation(name, fallback) {
    return animator.hasAnimation(name) ? name : fallback;
}

function playAnimation(animationName) {
    animator.ensure(animationName);
}

function transitionTo(nextState, timeout) {
    if (pendingTransitionEvent) {
        pendingTransitionEvent.abort = true;
        pendingTransitionEvent = null;
    }

    var delay = typeof timeout === "number" ? timeout : 0;
    if (delay > 0) {
        pendingTransitionEvent = timer.addEvent(delay, false, function () {
            pendingTransitionEvent = null;
            execute(nextState);
        });
    } else {
        execute(nextState);
    }
    function execute(state) {
        if (currentState === state) return;
        var prevState = currentState;
        var prevHandler = states[prevState];
        if (prevHandler && typeof prevHandler.exit === "function") prevHandler.exit();

        clearHotspots();
        clearStateEvents();
        currentState = state;
        stateStarted = clockMs();

        var handler = states[state];
        if (handler && typeof handler.enter === "function") handler.enter();
    }

}

function pollInput() {
    var key = console.inkey(K_NONE, 0);
    if (!key) return;

    if (key === "\x1b") {
        running = false;
        return;
    }

    var keyUpper = key.length === 1 ? key.toUpperCase() : key;

    switch (currentState) {
        case "welcome":
            transitionTo("mouse_prompt");
            break;
        case "mouse_prompt":
            if (keyUpper === "C") {
                session.mouse = true;
                transitionTo("mouse_success");
            }
            break;
        case "color_prompt":
            if (keyUpper === "Y") {
                session.color = true;
                transitionTo("color_yes");
            } else if (keyUpper === "N") {
                session.color = false;
                transitionTo("color_no");
            }
            break;
        case "exascii_prompt":
            if (keyUpper === "L") {
                session.exascii = true;
                transitionTo("exascii_ok");
            } else if (keyUpper === "B") {
                session.exascii = false;
                transitionTo("exascii_bad");
            }
            break;
        case "backspace_prompt":
            handleBackspaceInput(key);
            break;
        case "alias_prompt":
            handleAliasInput(key);
            break;
        case "password_prompt":
            handlePasswordInput(key);
            break;
        case "password_confirm":
            handlePasswordConfirmInput(key);
            break;
        case "email_prompt":
            handleEmailInput(key);
            break;
        case "email_confirm":
            handleEmailConfirmInput(key);
            break;
        case "rules_prompt":
            if (keyUpper === "Y") {
                session.rulesAccepted = true;
                transitionTo("confirm_prompt");
            } else if (keyUpper === "N") {
                session.rulesAccepted = false;
                transitionTo("alias_prompt");
            }
            break;
        case "confirm_prompt":
            if (keyUpper === "Y") {
                session.confirmed = true;

                // Create (or dry-run if TEST_FLOW)
                var res = createAccountFromSession(typeof TEST_FLOW !== "undefined" && TEST_FLOW === true);

                if (!res.ok) {
                    // Show an inline error and let them fix things (usually alias)
                    playAnimation(shakeAnim);
                    centerLine(speechBubbleText, "\1r" + (res.err || "could not create user"));
                    // Bounce back to alias to fix name collisions, etc.
                    transitionTo("alias_prompt");
                } else if (res.test) {
                    // Dry-run summary and continue to the "done" screen
                    persistSession(); // your logging
                    transitionTo("done_prompt");
                } else {
                    // Real account created; we likely just logged them on.
                    exit();
                    persistSession(); // your logging
                    transitionTo("done_prompt");
                }
            } else if (keyUpper === "N") {
                transitionTo("alias_prompt");
            }
            break;
        case "done_prompt":
            running = false;
            break;
    }
}

function startAnimationLoop() {
    if (animationEvent) animationEvent.abort = true;
    animationEvent = timer.addEvent(MIN_FRAME_INTERVAL_MS, true, function () {
        var wait = animator.step();
        animationEvent.interval = Math.max(MIN_FRAME_INTERVAL_MS, wait);
    });
}

function startInputLoop() {
    if (inputEvent) inputEvent.abort = true;
    inputEvent = timer.addEvent(INPUT_POLL_INTERVAL, true, pollInput);
}

function renderColorPrompt() {
    centerLine(speechBubbleText, "do these look like 8 distinct shades - not blinking?");
    main.clear();
    for (var i = 0; i < 8; i++) {
        var spacePer = 6;
        var spacer = 16;
        var yPos = 4;
        main.attr = BG_BLACK | (i + 8);
        main.gotoxy(spacer + i * spacePer, yPos);
        main.putmsg("   " + i + "   ");
    }
    main.attr = BG_BLUE | LIGHTGRAY;
    var yesLabel = "[Y] Yes";
    var noLabel = "[N] No";
    var spacing = "  ";
    var margin = 2;
    var totalWidth = 20;
    var excess = parseInt((console.screen_columns - 80) / 2);
    var start = (main.width - (totalWidth * 2) + margin) / 2 + excess;

    //((main.width - totalWidth) / 2 | 0) + 1;
    var buttonY = main.height - spritePane.height - statePrompt.height;
    button = new Frame(start, buttonY, totalWidth, 3, BG_GREEN | LIGHTGRAY, main);
    button.gotoxy(1, 2); button.center("\1h" + yesLabel + "\1n");
    button2 = new Frame(start + totalWidth + margin, buttonY, totalWidth, 3, BG_RED | LIGHTGRAY, main);
    button2.gotoxy(1, 2); button2.center("\1h" + noLabel + "\1n");
    button.open(); button2.open();
    button.drawBorder(WHITE | BG_GREEN);
    button2.drawBorder(WHITE | BG_RED);
    button.draw(); button2.draw();
    main.draw();
    main.cycle();
    addHotspotForFrame(button, "Y");
    addHotspotForFrame(button2, "N");
}

function renderExasciiPrompt() {
    button.clear(); button.close(); button = null; button2.clear(); button2.close(); button2 = null; main.cycle();
    centerLine(speechBubbleText, "do these corners look tidy? [L/B]");
    main.clear();
    var tidy = ["\xDA\xC4\xC4\xBF", "\xB3  \xB3", "\xC0\xC4\xC4\xD9"];
    var messy = ["+--+", "|  |", "+--'`"];
    var firstBoxX = 28;
    var secondBoxX = 48;
    var yOffset = 2;
    for (var i = 0; i < tidy.length; i++) {
        main.gotoxy(firstBoxX, yOffset + i);
        main.putmsg("\1h" + tidy[i] + "\1n");
        main.gotoxy(secondBoxX, yOffset + i);
        main.putmsg(messy[i]);
    }
    var totalWidth = 20;
    var margin = 2;
    var excess = parseInt((console.screen_columns - 80) / 2);
    var start = (main.width - (totalWidth * 2) + margin) / 2 + excess;
    var yesLabel = "[L] Looks Good";
    var noLabel = "[B] Broken";
    //((main.width - totalWidth) / 2 | 0) + 1;
    var buttonY = main.height - spritePane.height - statePrompt.height;
    button = new Frame(start, buttonY, totalWidth, 3, BG_GREEN | LIGHTGRAY, main);
    button.gotoxy(1, 2); button.center("\1h" + yesLabel + "\1n");
    button2 = new Frame(start + totalWidth + margin, buttonY, totalWidth, 3, BG_RED | LIGHTGRAY, main);
    button2.gotoxy(1, 2); button2.center("\1h" + noLabel + "\1n");
    button.open(); button2.open();
    button.drawBorder(WHITE | BG_GREEN);
    button2.drawBorder(WHITE | BG_RED);
    button.draw(); button2.draw();
    main.draw();
    main.cycle();
    addHotspotForFrame(button, "L");
    addHotspotForFrame(button2, "B");
}

function resetBackspaceProgress() {
    backspaceBuffer = "";
    backspaceStage = "type";
}

function renderBackspaceScreen() {
    main.clear();
    main.gotoxy(3, 4);
    main.putmsg("type: abc");
    main.gotoxy(3, 6);
    main.putmsg("input: ");
    updateBackspaceDisplay();
    main.draw();
}

function updateBackspaceDisplay() {
    main.gotoxy(11, 6);
    var shown = backspaceBuffer.length ? backspaceBuffer : "(empty)";
    var padded = shown + spaces(Math.max(0, 20 - shown.length));
    main.putmsg("\1h" + padded + "\1n");
    main.draw();
}

function handleBackspaceInput(key) {
    if (key.length !== 1) return;
    var code = key.charCodeAt(0);

    if (code === 8 || code === 127) {
        if (backspaceBuffer.length > 0) {
            backspaceBuffer = backspaceBuffer.substr(0, backspaceBuffer.length - 1);
            updateBackspaceDisplay();
        }
        if (backspaceStage === "erase" && backspaceBuffer.length === 0) {
            session.backspace = true;
            transitionTo("alias_prompt");
        }
        return;
    }

    if (code === 10 || code === 13) return;
    if (code < 32) return;

    var expected = "abc";
    if (backspaceStage === "type") {
        var nextIndex = backspaceBuffer.length;
        if (expected.charAt(nextIndex) === key.toLowerCase()) {
            backspaceBuffer += key.toLowerCase();
            updateBackspaceDisplay();
            if (backspaceBuffer.length === expected.length) {
                backspaceStage = "erase";
                centerLine(speechBubbleText, "now backspace to erase it");
                showTitle("KEYBOARD TEST");
            }
        }
    }
}

function renderAliasScreen() {
    main.clear();
    main.gotoxy(3, 4);
    main.putmsg("alias: ");
    aliasBuffer = session.alias || "";
    updateAliasDisplay();
    main.draw();
}

function updateAliasDisplay() {
    main.gotoxy(11, 4);
    var shown = aliasBuffer.length ? aliasBuffer : "(blank)";
    var padded = shown + spaces(Math.max(0, ALIAS_MAX_LENGTH - shown.length));
    main.putmsg("\1h" + padded + "\1n");
    main.draw();
}

function handleAliasInput(key) {
    if (key.length !== 1) return;
    var code = key.charCodeAt(0);

    if (code === 8 || code === 127) {
        if (aliasBuffer.length > 0) {
            aliasBuffer = aliasBuffer.substr(0, aliasBuffer.length - 1);
            updateAliasDisplay();
        }
        return;
    }

    if (code === 10 || code === 13) {
        var trimmed = aliasBuffer.trim();
        if (!trimmed.length) {
            playAnimation(shakeAnim);
            showTitle("alias can't be blank");
            return;
        }
        if (aliasExists(trimmed)) {
            playAnimation(shakeAnim);
            centerLine(speechBubbleText, "\1h\1ralias in use; pick another");
            aliasBuffer = "";
            session.alias = "";
            updateAliasDisplay();
            return;
        }
        session.alias = trimmed;
        playAnimation(nodAnim);
        if (!session.password) transitionTo("password_prompt");
        else if (!session.email) transitionTo("email_prompt");
        else transitionTo("rules_prompt");
        return;
    }

    if (code < 32) return;
    if (aliasBuffer.length >= ALIAS_MAX_LENGTH) return;

    aliasBuffer += key;
    updateAliasDisplay();
}

function aliasExists(name) {
    if (!name) return false;
    var search = name.toLowerCase();
    var u = new User;
    var total = system.lastuser || 0;
    for (var i = 1; i <= total; i++) {
        u.number = i;
        if (u.settings & (USER_DELETED | USER_INACTIVE)) continue;
        var alias = u.alias ? u.alias.toLowerCase() : "";
        if (alias === search) return true;
    }
    return false;
}

function renderPasswordScreen(isConfirm) {
    main.clear();
    main.gotoxy(3, 4);
    main.putmsg(isConfirm ? "confirm password:" : "password:");
    updatePasswordDisplay(isConfirm);
    main.draw();
}

function updatePasswordDisplay(isConfirm) {
    var buffer = isConfirm ? passwordConfirmBuffer : passwordBuffer;
    var placeholder = "(blank)";
    var shown = buffer.length ? repeat(buffer.length, '*') : placeholder;
    main.gotoxy(3, 6);
    main.putmsg("\1h" + shown + "\1n" + spaces(Math.max(0, 32 - shown.length)));
    main.draw();
}

function handlePasswordInput(key) {
    if (key.length !== 1) return;
    var code = key.charCodeAt(0);
    if (code === 8 || code === 127) {
        if (passwordBuffer.length > 0) {
            passwordBuffer = passwordBuffer.substr(0, passwordBuffer.length - 1);
            updatePasswordDisplay(false);
        }
        return;
    }
    if (code === 10 || code === 13) {
        if (passwordBuffer.length < 4) {
            playAnimation(shakeAnim);
            showTitle("password must be at least 4 characters");
            centerLine(speechBubbleText, "\1rpassword must be at least 4 characters");

            return;
        }
        session.password = passwordBuffer;
        playAnimation(nodAnim);
        transitionTo("password_confirm");
        return;
    }
    if (code < 32) return;
    if (passwordBuffer.length >= 32) return;
    passwordBuffer += key;
    updatePasswordDisplay(false);
}

function handlePasswordConfirmInput(key) {
    if (key.length !== 1) return;
    var code = key.charCodeAt(0);
    if (code === 8 || code === 127) {
        if (passwordConfirmBuffer.length > 0) {
            passwordConfirmBuffer = passwordConfirmBuffer.substr(0, passwordConfirmBuffer.length - 1);
            updatePasswordDisplay(true);
        }
        return;
    }
    if (code === 10 || code === 13) {
        if (passwordConfirmBuffer !== session.password) {
            playAnimation(shakeAnim);
            showTitle("passwords do not match");
            passwordBuffer = "";
            passwordConfirmBuffer = "";
            session.password = "";
            transitionTo("password_prompt");
            return;
        }
        passwordConfirmBuffer = "";
        playAnimation(nodAnim);
        if (!session.email) transitionTo("email_prompt");
        else transitionTo("rules_prompt");
        return;
    }
    if (code < 32) return;
    if (passwordConfirmBuffer.length >= 32) return;
    passwordConfirmBuffer += key;
    updatePasswordDisplay(true);
}

function renderEmailScreen(isConfirm) {
    main.clear();
    main.gotoxy(3, 4);
    main.putmsg(isConfirm ? "confirm email:" : "email:");
    updateEmailDisplay(isConfirm);
    main.draw();
}

function updateEmailDisplay(isConfirm) {
    var buffer = isConfirm ? emailConfirmBuffer : emailBuffer;
    var placeholder = "(blank)";
    var shown = buffer.length ? buffer : placeholder;
    main.gotoxy(3, 6);
    main.putmsg("\1h" + shown + "\1n" + spaces(Math.max(0, 48 - shown.length)));
    main.draw();
}

function isValidEmail(addr) {
    if (!addr) return false;
    if (addr.length < 3 || addr.length > 48) return false;
    if (addr.indexOf(' ') !== -1) return false;
    var simple = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    return simple.test(addr);
}

function handleEmailInput(key) {
    if (key.length !== 1) return;
    var code = key.charCodeAt(0);
    if (code === 8 || code === 127) {
        if (emailBuffer.length > 0) {
            emailBuffer = emailBuffer.substr(0, emailBuffer.length - 1);
            updateEmailDisplay(false);
        }
        return;
    }
    if (code === 10 || code === 13) {
        var trimmed = emailBuffer.trim();
        if (!isValidEmail(trimmed)) {
            playAnimation(shakeAnim);
            showTitle("enter a valid email address");
            return;
        }
        session.email = trimmed;
        playAnimation(nodAnim);
        transitionTo("email_confirm");
        return;
    }
    if (code < 32) return;
    if (emailBuffer.length >= 48) return;
    emailBuffer += key;
    updateEmailDisplay(false);
}

function handleEmailConfirmInput(key) {
    if (key.length !== 1) return;
    var code = key.charCodeAt(0);
    if (code === 8 || code === 127) {
        if (emailConfirmBuffer.length > 0) {
            emailConfirmBuffer = emailConfirmBuffer.substr(0, emailConfirmBuffer.length - 1);
            updateEmailDisplay(true);
        }
        return;
    }
    if (code === 10 || code === 13) {
        var trimmed = emailConfirmBuffer.trim();
        if (trimmed !== session.email) {
            playAnimation(shakeAnim);
            showTitle("email addresses do not match");
            emailBuffer = "";
            emailConfirmBuffer = "";
            session.email = "";
            transitionTo("email_prompt");
            return;
        }
        emailConfirmBuffer = "";
        playAnimation(nodAnim);
        transitionTo("rules_prompt");
        return;
    }
    if (code < 32) return;
    if (emailConfirmBuffer.length >= 48) return;
    emailConfirmBuffer += key;
    updateEmailDisplay(true);
}

function renderRulesScreen() {
    main.clear();
    centerMain("keep it short. keep it kind. no spoilers in public.");
    centerMain("\1h\1wAccept? [Y]es / [N]o", 2);
}

function boolLabel(val) {
    if (val === null) return "?";
    return val ? "yes" : "no";
}

function renderConfirmSummary() {
    main.clear();
    main.gotoxy(3, 4);
    main.putmsg(format("mouse input: %s", boolLabel(session.mouse)));
    main.gotoxy(3, 5);
    main.putmsg(format("color depth: %s", boolLabel(session.color)));
    main.gotoxy(3, 6);
    main.putmsg(format("exascii: %s", boolLabel(session.exascii)));
    main.gotoxy(3, 7);
    main.putmsg(format("backspace: %s", session.backspace ? "yes" : "no"));
    main.gotoxy(3, 8);
    main.putmsg(format("rules ok: %s", session.rulesAccepted ? "yes" : "no"));
    main.gotoxy(3, 10);
    main.putmsg("alias: \1h" + (session.alias || "(blank)") + "\1n");
    main.gotoxy(3, 11);
    main.putmsg("email : \1h" + (session.email || "(blank)") + "\1n");
    main.draw();
}

function renderDoneScreen() {
    main.clear();
    main.gotoxy(3, 5);
    main.putmsg("alias registered: \1h" + (session.alias || "(blank)") + "\1n");
    main.gotoxy(3, 7);
    main.putmsg("email on file : \1h" + (session.email || "(blank)") + "\1n");
    main.draw();
}

function persistSession() {
    var flags = {
        USER_MOUSE: session.mouse === true,
        USER_ICECOLOR: session.color === true,
        USER_EXASCII: session.exascii === true,
        USER_DELBS: session.backspace === true,
        USER_ANSI: true,
        USER_COLOR: session.color !== false
    };
    var flagsStr = format(
        "USER_MOUSE=%s USER_ICECOLOR=%s USER_EXASCII=%s USER_DELBS=%s USER_ANSI=%s USER_COLOR=%s",
        flags.USER_MOUSE ? "1" : "0",
        flags.USER_ICECOLOR ? "1" : "0",
        flags.USER_EXASCII ? "1" : "0",
        flags.USER_DELBS ? "1" : "0",
        flags.USER_ANSI ? "1" : "0",
        flags.USER_COLOR ? "1" : "0"
    );
    log(LOG_INFO, format("future_signup alias=%s email=%s %s", session.alias || "(blank)", session.email || "(blank)", flagsStr));
}

var defaultAnim = animations.first;
var idleAnim = chooseAnimation("idle", defaultAnim);
var thinkAnim = chooseAnimation("think", defaultAnim);
var pointAnim = chooseAnimation("point_right", idleAnim);
var celebrateAnim = chooseAnimation("celebrate", idleAnim);
var shrugAnim = chooseAnimation("shrug", idleAnim);
var nodAnim = chooseAnimation("nod_yes", idleAnim);
var shakeAnim = chooseAnimation("shake_no", shrugAnim);

var states = {
    welcome: {
        enter: function () {
            resetSession();
            centerLine(speechBubbleText, "hiya! i'll keep this fast. ready?");
            main.clear();
            main.draw();
            playAnimation(idleAnim);
            showTitle('');
            centerMain("press any key to begin.");
        }
    },
    mouse_prompt: {
        enter: function () {
            console.mouse_mode = true;
            centerLine(speechBubbleText, "click the big button or press C.");
            main.clear();
            buttonWidth = main.width / 2;
            buttonY = main.height / 2 - statePrompt.height;
            var excess = parseInt((console.screen_columns - 80) / 2);
            button = new Frame(parseInt(main.width / 4) + excess, buttonY, buttonWidth, 5, BG_GREEN | WHITE, main);
            var clickLabel = "[ CLICK ]";
            var clickStart = ((main.width - clickLabel.length) / 2 | 0) + 1;
            // main.gotoxy(clickStart, 3);
            button.open();
            button.draw();
            button.drawBorder(BG_GREEN | WHITE);
            button.gotoxy(1, 3);
            button.center("\1h\1w" + clickLabel + "\1n");
            main.draw();
            seconds = MOUSE_TIMEOUT_MS / 1000;
            buttonInterval = timer.addEvent(1000, true, function () {
                seconds--;
                button.gotoxy(button.width / 2, 2);
                button.putmsg(JSON.stringify(seconds));
                button.cycle();
            });
            addHotspotForFrame(button, "C");
            playAnimation(pointAnim);
            showTitle("MOUSE TEST", [{ label: "press C", cmd: "C" }]);
            scheduleStateEvent(MOUSE_TIMEOUT_MS, function () {
                session.mouse = false;
                transitionTo("mouse_fail");
            });
        }
    },
    mouse_success: {
        enter: function () {
            if (buttonInterval) buttonInterval.abort = true;
            session.mouse = true;
            centerLine(speechBubbleText, "clicks working. sweet.");
            playAnimation(celebrateAnim);
            showTitle("nice! moving on...");
            scheduleStateEvent(REACTION_DELAY_MS, function () {
                transitionTo("color_prompt");
            });
        }
    },
    mouse_fail: {
        enter: function () {
            if (buttonInterval) buttonInterval.abort = true;
            session.mouse = false;
            centerLine(speechBubbleText, "no click? no prob. keys it is.");
            playAnimation(shrugAnim);
            showTitle("keyboard it is");
            scheduleStateEvent(REACTION_DELAY_MS, function () {
                transitionTo("color_prompt");
            });
        }
    },
    color_prompt: {
        enter: function () {
            if (buttonInterval) buttonInterval.abort = true;
            button.close();
            button = null;
            session.color = null;
            playAnimation(thinkAnim);
            renderColorPrompt();
            showTitle("COLOR TEST", [
                { label: "[Y] looks right", cmd: "Y" },
                { label: "[N] looks off", cmd: "N" }
            ]);
        }
    },
    color_yes: {
        enter: function () {
            session.color = true;
            centerLine(speechBubbleText, "great!");
            playAnimation(nodAnim);
            showTitle("cool, next up...");
            scheduleStateEvent(REACTION_DELAY_MS, function () {
                transitionTo("exascii_prompt");
            });
        }
    },
    color_no: {
        enter: function () {
            session.color = false;
            centerLine(speechBubbleText, "no worries, we'll adapt.");
            playAnimation(shakeAnim);
            showTitle("thanks, logging it");
            scheduleStateEvent(REACTION_DELAY_MS, function () {
                transitionTo("exascii_prompt");
            });
        }
    },
    exascii_prompt: {
        enter: function () {
            session.exascii = null;
            playAnimation(pointAnim);
            renderExasciiPrompt();
            showTitle("FONT TEST", [
                { label: "[L] tidy", cmd: "L" },
                { label: "[B] busted", cmd: "B" }
            ]);
        }
    },
    exascii_ok: {
        enter: function () {
            centerLine(speechBubbleText, "tidy corners. nice!");
            playAnimation(nodAnim);
            showTitle("noted");
            scheduleStateEvent(REACTION_DELAY_MS, function () {
                transitionTo("backspace_prompt");
            });
        }
    },
    exascii_bad: {
        enter: function () {
            centerLine(speechBubbleText, "got it. we'll watch for glitches.");
            playAnimation(shakeAnim);
            showTitle("we'll adjust");
            scheduleStateEvent(REACTION_DELAY_MS, function () {
                transitionTo("backspace_prompt");
            });
        }
    },
    backspace_prompt: {
        enter: function () {
            button.clear(); button.close(); button = null; button2.clear(); button2.close(); button2 = null; main.cycle();
            session.backspace = false;
            centerLine(speechBubbleText, "type abc, then erase to empty.");
            playAnimation(thinkAnim);
            resetBackspaceProgress();
            renderBackspaceScreen();
            showTitle("type the letters, then Backspace");
        }
    },
    alias_prompt: {
        enter: function () {
            centerLine(speechBubbleText, "pick a name. we'll make it yours.");
            playAnimation(pointAnim);
            renderAliasScreen();
            showTitle("USERNAME SELECTION");
        }
    },
    password_prompt: {
        enter: function () {
            passwordBuffer = "";
            centerLine(speechBubbleText, "Nice name, \1h\1w" + session.alias + "\1h\1y. \r\n Set a password.");
            playAnimation(thinkAnim);
            renderPasswordScreen(false);
            showTitle("SET PASSWORD");
        }
    },
    password_confirm: {
        enter: function () {
            passwordConfirmBuffer = "";
            centerLine(speechBubbleText, "confirm password.");
            playAnimation(pointAnim);
            renderPasswordScreen(true);
            showTitle("VERIFY PASSWORD");
        }
    },
    email_prompt: {
        enter: function () {
            emailBuffer = session.email || "";
            centerLine(speechBubbleText, "what's your email?");
            playAnimation(thinkAnim);
            renderEmailScreen(false);
            showTitle("Recovery email address");
        }
    },
    email_confirm: {
        enter: function () {
            emailConfirmBuffer = "";
            centerLine(speechBubbleText, "confirm email.");
            playAnimation(pointAnim);
            renderEmailScreen(true);
            showTitle("CONFIRM EMAIL");
        }
    },
    rules_prompt: {
        enter: function () {
            session.rulesAccepted = false;
            centerLine(speechBubbleText, "house rules-short + kind.");
            playAnimation(thinkAnim);
            renderRulesScreen();
            showTitle("RULES", [
                { label: "[Y] I'm in", cmd: "Y" },
                { label: "[N] tweak alias", cmd: "N" }
            ]);
        }
    },
    confirm_prompt: {
        enter: function () {
            session.confirmed = false;
            centerLine(speechBubbleText, "all set? i'll file the paperwork.");
            playAnimation(thinkAnim);
            renderConfirmSummary();
            showTitle("VERIFY DETAILS", [
                { label: "[Y] confirm", cmd: "Y" },
                { label: "[N] edit alias", cmd: "N" }
            ]);
        }
    },
    done_prompt: {
        enter: function () {
            centerLine(speechBubbleText, "welcome aboard.");
            playAnimation(celebrateAnim);
            renderDoneScreen();
            showTitle("SIGNUP COMPLETE");
        }
    }
};

/* ========================= main loop ========================= */
function cleanup() {
    clearStateEvents();
    clearHotspots();
    if (animationEvent) animationEvent.abort = true;
    if (inputEvent) inputEvent.abort = true;
    if (pendingTransitionEvent) {
        pendingTransitionEvent.abort = true;
        pendingTransitionEvent = null;
    }
    root.close();
}

function mainLoop() {
    root.open();
    startAnimationLoop();
    startInputLoop();
    transitionTo("welcome");

    while (running && !js.terminated) {
        timer.cycle();
        mswait(TIMER_IDLE_DELAY);
    }

    cleanup();
}

try {
    mainLoop();
} catch (err) {
    log(LOG_ERR, "future_signup failed: " + err);
    try { cleanup(); } catch (e) { }
    throw err;
}
