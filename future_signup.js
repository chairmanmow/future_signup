load("userdefs.js");
load("sbbsdefs.js");
load("frame.js");
load("event-timer.js");

/* ========================= constants ========================= */
const SCREEN_WIDTH = console.screen_columns;
const SCREEN_HEIGHT = console.screen_rows;
const MIN_SCREEN_HEIGHT = 20;
if (SCREEN_HEIGHT < MIN_SCREEN_HEIGHT) {
    console.clear();
    console.writeln("\r\n  Your terminal has " + SCREEN_HEIGHT + " rows but the signup wizard");
    console.writeln("  requires at least " + MIN_SCREEN_HEIGHT + " rows.");
    console.writeln("  Please resize your terminal and try again.\r\n");
    mswait(3000);
    exit();
}
const MOD_DIR = '/sbbs/mods/future_signup/';
load(MOD_DIR + "post_signup.js");
var SignupI18n = load(MOD_DIR + "signup_localization.js");
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
/* ========================= mock mode ========================= */
/*
 * The sysop-menu entry (xtrn NEWUSERFLOW -> xtrn/new_user/new_user.js) runs
 * the wizard for real - every prompt, animation and validation - but files no
 * paperwork: no user record is created and the invoking sysop's own session is
 * never re-logged-in as somebody else. Triggered by a "mock" load() argument,
 * or by the legacy TEST_FLOW global for callers that still set it.
 */
var MOCK_MODE = (function () {
    try {
        if (typeof TEST_FLOW !== "undefined" && TEST_FLOW === true) return true;
        if (typeof argv !== "undefined" && argv) {
            for (var i = 0; i < argv.length; i++) {
                var a = String(argv[i]).toLowerCase();
                if (a === "mock" || a === "test" || a === "dry" || a === "dryrun") return true;
            }
        }
    } catch (e) { }
    return false;
})();
log(LOG_INFO, "future_signup.js loaded, mock=" + MOCK_MODE);

/* Reuse the logon/shell reading when available; the live NEW-user path enters
   here before customlogon.js normally measures the link. Probe before painting
   or polling input, never in an animation callback. Unknown stays full-speed. */
function signupLinkProfile() {
    var tier = 'full';
    try { tier = load({}, '/sbbs/mods/load/linkspeed.js').tier(); }
    catch (e) { log(LOG_WARNING, 'future_signup linkspeed unavailable: ' + e); }
    if (tier !== 'static' && tier !== 'lite') tier = 'full';
    return {
        tier: tier,
        animate: tier !== 'static',
        minFrameMs: tier === 'lite' ? 800 : MIN_FRAME_INTERVAL_MS,
        speedScale: tier === 'lite' ? 4 : 1,
        inputQuietMs: tier === 'lite' ? 2000 : 0,
        countdownMs: tier === 'static' ? 5000 : (tier === 'lite' ? 2000 : 1000)
    };
}
var linkProfile = signupLinkProfile();
log(LOG_INFO, 'future_signup animation tier=' + linkProfile.tier);
console.autoterm |= USER_MOUSE;

/* ========================= 3dBBS depth ========================= */
/*
 * On the 3dBBS terminal the wizard's frame stack renders at real stereo
 * depths. Text can never come forward of the glass (protocol v1 - the glass IS
 * the near plane), so CLIPPY "popping out" means CLIPPY sits AT the glass and
 * everything else is pushed back behind him. His speech bubble trails just
 * off his shoulder, the buttons float above the form, the form sits mid-field
 * and the panel and root recede to the back wall.
 *
 * Layer index is the array index below, and layer 0 must stay the glass:
 * anything written outside the frame diff (the cursor, printfile output)
 * lands there.
 */
const SCENE3D_SPREAD = 4;   // world units from the glass to the back wall
// Near to far. Tune the fractions freely - the client re-depths every painted
// cell from the table, so depth is a table edit, not a repaint.
var DEPTH_BAND_ORDER = ['glass', 'bubble', 'button', 'chrome', 'content', 'panel', 'backdrop'];
var DEPTH_BANDS = {
    glass: 0.0,      // CLIPPY, and anything unrecognized: the nearest plane there is
    bubble: 0.12,    // his speech bubble, just off his shoulder
    button: 0.3,     // clickable buttons float above the form
    chrome: 0.42,    // the title bar: the instruction line, proud of the pane
    content: 0.55,   // the main pane: prompts, input, the color swatches
    panel: 0.8,      // the centered container the whole wizard sits in
    backdrop: 1.0    // root: the far background
};

var Scene3dMod = null;
try {
    Scene3dMod = load("/sbbs/mods/load/scene3d.js");
} catch (e) { try { log(LOG_WARNING, "future_signup scene3d load failed: " + e); } catch (_) { } }
var depthLayers = null;

/*
 * Ancestry decides the band, identity first at each hop: the speech bubble and
 * the buttons are children of `main`, and the sprite pane is a child of the
 * container, so each has to match as itself before the walk reaches its parent
 * and bands it with the surface behind it.
 */
function depthBandFor(frame) {
    var node = frame;
    for (var hops = 0; node && hops < 8; hops++) {
        if (node === spritePane) return 'glass';
        if (node === speechBubble || node === speechBubbleText) return 'bubble';
        if (node === button || node === button2) return 'button';
        if (node === main) return 'content';
        if (node === statePrompt) return 'chrome';
        if (node === centeredContainer) return 'panel';
        if (node === root) return 'backdrop';
        try { node = node.parent; } catch (e) { return 'glass'; }
    }
    return 'glass';
}

function initDepth() {
    if (!Scene3dMod) return;
    var version = null;
    try { version = Scene3dMod.probe(500); } catch (e) { return; }
    if (!Scene3dMod.supportsTextLayers(version)) return;
    var layers = new Scene3dMod.TextDepthLayers({
        spread: SCENE3D_SPREAD,
        order: DEPTH_BAND_ORDER,
        depths: DEPTH_BANDS,
        bandFor: depthBandFor,
        log: function (msg) { try { log(LOG_INFO, "future_signup " + msg); } catch (e) { } }
    });
    // The frames below do not exist yet; bandFor reads them lazily and only
    // ever runs at cycle() time, which is later still.
    if (layers.install(typeof Display !== "undefined" ? Display : null)) depthLayers = layers;
}
initDepth();

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

function tr(key, fallback, params) {
    return SignupI18n.text(key, fallback, params);
}

function signupActionKey(key, fallback) {
    return tr(key, fallback).charAt(0).toUpperCase();
}

function localizeSignupError(message) {
    var value = String(message || "");
    var count = /password must be at least ([0-9]+) characters/i.exec(value);
    if (count) return tr("password.tooShort", value, { count: count[1] });
    count = /password must be at most ([0-9]+) characters/i.exec(value);
    if (count) return tr("password.tooLong", value, { count: count[1] });
    if (value === "password can't be built from your name") return tr("password.nameError", value);
    if (value === "that password is too common - pick another") return tr("password.commonError", value);
    if (value === "password needs more variety") return tr("password.varietyError", value);
    if (value === "Alias not allowed" || value === "Alias cannot produce a valid real name")
        return tr("error.aliasNotAllowed", value);
    if (value === "Alias already exists") return tr("error.aliasExists", value);
    if (value === "Email already registered") return tr("error.emailExists", value);
    if (value === "auto-login failed") return tr("error.autoLogin", value);
    if (value === "signup crashed") return tr("error.signupCrashed", value);
    if (value.indexOf("new_user()") === 0 || value === "Create already attempted")
        return tr("error.create", value);
    return value || tr("error.create", "could not create user");
}

/**
 * The account rules chksetup enforces (real name derivation, password
 * length/obviousness/trashcan/quality) live in one shared module so this
 * wizard and the fix_realnames backfill cannot drift apart.
 */
var UserPolicy = load("/sbbs/mods/load/user_policy.js");

/** The real name we file for a handle; see user_policy.js for the rules. */
function realNameFromAlias(alias) {
    return UserPolicy.deriveRealName(alias) || UserPolicy.realNameFromAlias(alias);
}

/** The identity a password is checked against - it does not exist yet. */
function signupIdentity() {
    return {
        alias: session.alias,
        name: realNameFromAlias(session.alias),
        handle: String(session.alias || "").substr(0, LEN_HANDLE)
    };
}

/**
 * True when another account already claims this address. Case-insensitive,
 * and it skips deleted/inactive records - the same accounts aliasExists()
 * ignores, so the two uniqueness rules agree on who counts as a live user.
 */
function emailExists(addr) {
    if (!addr) return false;
    try {
        return system.matchuserdata(U_NETMAIL, addr) > 0;
    } catch (e) {
        try { log(LOG_WARNING, "future_signup emailExists failed: " + e); } catch (_) { }
        return false;
    }
}

function createAccountFromSession() {
    if (_creationDone) return { ok: false, err: "Create already attempted" };

    // Validate before touching files
    if (!session.alias || !system.check_name(session.alias))
        return { ok: false, err: "Alias not allowed" };
    if (system.matchuser(session.alias))
        return { ok: false, err: "Alias already exists" };
    // Re-check at commit time: the address was free when they typed it, but
    // another node may have claimed it while they finished the wizard.
    if (session.email && emailExists(session.email))
        return { ok: false, err: "Email already registered" };
    // Last gate before the record exists: a password that fails policy must
    // never reach the user file, whatever path got it into the session.
    var pwProblem = UserPolicy.passwordProblem(
        String(session.password || "").toUpperCase(), signupIdentity());
    if (pwProblem) return { ok: false, err: pwProblem };
    if (!UserPolicy.deriveRealName(session.alias))
        return { ok: false, err: "Alias cannot produce a valid real name" };

    // Mock run: every check above ran for real. Nothing below this line
    // touches the user base or the caller's own session.
    if (MOCK_MODE) {
        _creationDone = true;
        log(LOG_INFO, format("future_signup MOCK: would create alias=%s name=%s email=%s location=%s",
            session.alias, realNameFromAlias(session.alias),
            session.email || "(blank)", session.location || "(blank)"));
        return { ok: true, test: true, alias: session.alias };
    }

    // 1) allocate the user slot
    var nu;
    try {
        nu = system.new_user(session.alias, client);
    } catch (e) {
        return { ok: false, err: "new_user() threw", detail: String(e) };
    }
    if (typeof nu === "number")
        return { ok: false, err: "new_user() failed", code: nu };

    var seedPassword = (nu && nu.security && typeof nu.security.password === "string") ? nu.security.password : "";
    var desiredPassword = (session.password && session.password.length) ? session.password.toUpperCase() : null;
    var loginOptions = [];
    function addLoginPassword(val) {
        if (typeof val !== "string") return;
        if (loginOptions.indexOf(val) !== -1) return;
        loginOptions.push(val);
    }
    addLoginPassword(seedPassword);
    if (desiredPassword) addLoginPassword(desiredPassword);
    addLoginPassword("");

    var loggedIn = false;
    for (var li = 0; li < loginOptions.length && !loggedIn; li++) {
        try {
            loggedIn = bbs.login(nu.alias, "", loginOptions[li]);
        } catch (loginErr) {
            log(LOG_WARNING, "future_signup auto-login attempt failed: " + loginErr);
        }
    }

    if (!loggedIn) {
        try { log(LOG_WARNING, "future_signup auto-login failed for alias " + session.alias); } catch (_) { }
        try {
            nu.comment = "future_signup: auto-login failed";
            nu.settings |= USER_DELETED;
        } catch (_) { }
        return { ok: false, err: "auto-login failed" };
    }

    try {
        // we are now the new user record
        user.number = nu.number;
        user.alias = session.alias.substr(0, LEN_ALIAS);
        user.name = realNameFromAlias(session.alias);
        user.handle = session.alias.substr(0, LEN_HANDLE);
        user.netmail = session.email || "";
        user.location = session.location || "";
        // English is Synchronet's native blank/default language code; the
        // installed translated text files use de/es/fr.
        user.lang = SignupI18n.nativeUserLang();
        user.gender = user.gender || ' ';

        user.settings |= USER_ANSI;
        if (session.color === true) user.settings |= USER_COLOR;
        if (session.color === false) user.settings &= ~USER_COLOR;
        if (session.exascii === true) user.settings &= ~USER_NO_EXASCII;
        if (session.exascii === false) user.settings |= USER_NO_EXASCII;

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

        if (desiredPassword) user.security.password = desiredPassword;

        bbs.user_sync();
        bbs.load_user_text();
        bbs.user_event(EVENT_NEWUSER);
        bbs.user_sync();

        _creationDone = true;
        return { ok: true, number: user.number, alias: user.alias };
    } catch (err) {
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
    // Each sprite is the same full-sized cell grid. Replacing cells in place
    // lets Frame keep its diff buffer; clear() invalidates the entire display
    // and makes even an unchanged sprite get transmitted again.
    for (var r = 0; r < frame.length; r++) {
        var row = frame[r];
        for (var c = 0; c < row.length; c++) {
            var cell = row[c];
            pane.setData(c, r, cell.ch, cell.attr, false);
        }
    }
    if (!pane.is_open) pane.open();
    pane.cycle();
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

function SpriteAnimator(pane, frames, animations, defaultAnimation, profile) {
    this.pane = pane;
    this.frames = frames;
    this.animations = animations;
    this.current = null;
    this.currentName = null;
    this.cursor = 0;
    this.nextTick = 0;
    this.profile = profile || { animate: true, minFrameMs: MIN_FRAME_INTERVAL_MS, speedScale: 1, inputQuietMs: 0 };
    this.resumeAt = 0;
    this.renderedFrame = null;
    this.defaultAnimation = defaultAnimation || null;
    this.pane.makeContentTransparent();
    this.pane.cycle();
}

SpriteAnimator.prototype.hasAnimation = function (name) {
    return this.animations.hasOwnProperty(name);
};

SpriteAnimator.prototype.frameInterval = function () {
    return Math.max(this.profile.minFrameMs, this.current.speed * this.profile.speedScale);
};

SpriteAnimator.prototype.noteInput = function (now) {
    if (!this.profile.inputQuietMs) return;
    this.resumeAt = (now !== undefined ? now : clockMs()) + this.profile.inputQuietMs;
    if (this.current) this.nextTick = this.resumeAt + this.frameInterval();
};

SpriteAnimator.prototype.play = function (name, now) {
    if (!this.animations.hasOwnProperty(name)) throw new Error("unknown animation " + name);
    var nowMs = now !== undefined ? now : clockMs();

    var anim = this.animations[name];
    this.current = anim;
    this.currentName = name;
    this.cursor = 0;
    this.nextTick = Math.max(nowMs, this.resumeAt) + this.frameInterval();
    this.renderCurrentFrame();
};

SpriteAnimator.prototype.ensure = function (name) {
    if (this.currentName !== name) this.play(name);
};

SpriteAnimator.prototype.renderCurrentFrame = function () {
    if (!this.current) return;
    var frameIndex = this.current.frames[Math.min(this.cursor, this.current.frames.length - 1)];
    if (this.renderedFrame === frameIndex) return;
    drawFrameToPane(this.pane, this.frames[frameIndex]);
    this.renderedFrame = frameIndex;
};

SpriteAnimator.prototype.step = function (now) {
    if (!this.current) return MIN_FRAME_INTERVAL_MS;
    // Static mode still selects an appropriate pose in play(), but never
    // generates idle traffic. It does not need a repeating timer at all.
    if (!this.profile.animate) return MIN_FRAME_INTERVAL_MS;
    var nowMs = now !== undefined ? now : clockMs();
    var interval = this.frameInterval();

    if (this.nextTick === 0) this.nextTick = nowMs + interval;
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
                    this.nextTick = nowMs + interval;
                    advanced = true;
                    break;
                }
            }
        }
        this.nextTick += interval;
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
    message = "\1r" + system.name + (MOCK_MODE ? " \1h\1yMOCK\1n\1r" : "") + " BOOTSTRAP USER \1n" + message;
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
var centeredContainer = new Frame(parseInt((SCREEN_WIDTH - 79) / 2) || 1, 1, 80, Math.min(24, SCREEN_HEIGHT), BG_LIGHTGRAY | BLACK, root);
log("created centered container at " + centeredContainer.x + "," + centeredContainer.y + " size " + centeredContainer.width + "x" + centeredContainer.height);
var statePrompt = new Frame(centeredContainer.x, 1, centeredContainer.width, 3, BG_CYAN | WHITE, centeredContainer);
var main = new Frame(centeredContainer.x, 4, centeredContainer.width, centeredContainer.height - statePromptHeight, BG_BLUE | WHITE, centeredContainer);
var spritePane = new Frame(centeredContainer.x + centeredContainer.width - 16, centeredContainer.height - 7, spriteSize[0], spriteSize[1], BG_GREEN | LIGHTGRAY, centeredContainer);
spritePane.transparent = true;
var speechBubbleWidth = centeredContainer.width / 2;
var speechBubble = new Frame(centeredContainer.x + speechBubbleWidth - 16, spritePane.y - 1, speechBubbleWidth, 5, BG_BLACK | BLACK, main);
var speechBubbleText = new Frame(speechBubble.x + 2, speechBubble.y + 1, speechBubble.width - 4, speechBubble.height - 2, BG_BLACK | YELLOW, speechBubble);
speechBubble.drawBorder(MAGENTA | BG_BLACK);
main.bottom();
spritePane.top();
root.cycle();
// TODO: can we prep the frames for transparency using sprite.setAttr or clearAttr on black cells?
var animator = new SpriteAnimator(spritePane, spriteData.frames, animations.map, animations.first, linkProfile);

var session = {
    lang: "en",
    mouse: null,
    color: null,
    exascii: null,
    backspace: false,
    alias: "",
    password: "",
    email: "",
    location: "",
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
var locationBuffer = "";

var hotspotsSupported = (typeof console.add_hotspot === "function" && typeof console.clear_hotspots === "function");

function resetSession() {
    session.lang = "en";
    SignupI18n.activate("en");
    session.mouse = null;
    session.color = null;
    session.exascii = null;
    session.backspace = false;
    session.alias = "";
    session.password = "";
    session.email = "";
    session.location = "";
    session.rulesAccepted = false;
    session.confirmed = false;
    backspaceBuffer = "";
    backspaceStage = "type";
    aliasBuffer = "";
    passwordBuffer = "";
    passwordConfirmBuffer = "";
    emailBuffer = "";
    emailConfirmBuffer = "";
    locationBuffer = "";
}

/* ========================= state + timer management ========================= */
var timer = new Timer();
var animationEvent = null;
var inputEvent = null;
var stateEvents = [];
var pendingTransitionEvent = null;
var pendingLogon = false;
var running = true;
var currentState = null;
var stateStarted = 0;

function clearHotspots() {
    if (hotspotsSupported) console.clear_hotspots();
}

function addHotspotForFrame(frame, cmd) {
    if (!hotspotsSupported) return;
    if (session.mouse === false) return; // hotspots re-enable mouse reporting
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
    animator.noteInput();

    if (key === "\x1b") {
        // ESC never ends signup. Some terminals (NetRunner) put a bare ESC on
        // the wire for every mouse click: sbbs's legacy X10 decoder
        // (ansi_terminal.cpp handle_non_SGR_mouse_sequence) range-checks the Y
        // byte against `ch` instead of `inch`, so the report fails and the ESC
        // falls through - and NetRunner keeps sending them even after
        // ?1000l/?1006l. Callers who want out can hang up.
        // Any bytes right behind the ESC are drained so a non-mouse sequence
        // can't leak into the alias/password fields, and logged for diagnosis.
        var tail = "";
        for (var d = 0; d < 16; d++) {
            var extra = console.inkey(K_NONE, 30);
            if (!extra) break;
            tail += extra;
        }
        var hex = "";
        for (var h = 0; h < tail.length; h++) hex += format("%02X ", tail.charCodeAt(h) & 0xFF);
        log(LOG_INFO, format("future_signup: ESC ignored state=%s mouse_mode=%s autoterm=0x%X tail=[%s]",
            currentState, String(console.mouse_mode), console.autoterm, hex));
        // During the mouse test it still means "clicks don't work here".
        if (currentState === "mouse_prompt") {
            session.mouse = false;
            transitionTo("mouse_fail");
        }
        return;
    }

    var keyUpper = key.length === 1 ? key.toUpperCase() : key;

    switch (currentState) {
        case "language_prompt":
            var languageChoices = SignupI18n.choices();
            for (var languageIndex = 0; languageIndex < languageChoices.length; languageIndex++) {
                var languageChoice = languageChoices[languageIndex];
                if (keyUpper !== languageChoice.key) continue;
                session.lang = SignupI18n.activate(languageChoice.code);
                transitionTo("welcome");
                break;
            }
            break;
        case "welcome":
            transitionTo("mouse_prompt");
            break;
        case "mouse_prompt":
            if (key === "~") {
                session.mouse = true;
                transitionTo("mouse_success");
            }
            if (keyUpper === signupActionKey("key.no", "N")) {
                session.mouse = false;
                transitionTo("mouse_fail");
            }
            break;
        case "color_prompt":
            if (keyUpper === signupActionKey("key.yes", "Y")) {
                session.color = true;
                transitionTo("color_yes");
            } else if (keyUpper === signupActionKey("key.no", "N")) {
                session.color = false;
                transitionTo("color_no");
            }
            break;
        case "exascii_prompt":
            if (keyUpper === signupActionKey("key.fontGood", "L")) {
                session.exascii = true;
                transitionTo("exascii_ok");
            } else if (keyUpper === signupActionKey("key.fontBad", "B")) {
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
        case "location_prompt":
            handleLocationInput(key);
            break;
        case "rules_prompt":
            if (keyUpper === signupActionKey("key.yes", "Y")) {
                session.rulesAccepted = true;
                transitionTo("confirm_prompt");
            } else if (keyUpper === signupActionKey("key.no", "N")) {
                session.rulesAccepted = false;
                transitionTo("alias_prompt");
            }
            break;
        case "confirm_prompt":
            if (keyUpper === signupActionKey("key.yes", "Y")) {
                session.confirmed = true;

                // Create for real, or dry-run under MOCK_MODE
                var res = createAccountFromSession();

                if (!res.ok) {
                    // Show an inline error and let them fix things (usually alias)
                    playAnimation(shakeAnim);
                    centerLine(speechBubbleText, "\1r" + localizeSignupError(res.err));
                    // Bounce back to alias to fix name collisions, etc.
                    transitionTo("alias_prompt");
                } else if (res.test) {
                    // Dry-run summary and continue to the "done" screen
                    persistSession(); // your logging
                    transitionTo("done_prompt");
                } else {
                    persistSession();
                    transitionTo("done_prompt");
                    pendingLogon = true;
                    scheduleStateEvent(Math.max(REACTION_DELAY_MS, MIN_ANIMATION_TIMEOUT), function () {
                        running = false;
                    });
                }
            } else if (keyUpper === signupActionKey("key.no", "N")) {
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
    animationEvent = null;
    if (!linkProfile.animate) return;
    animationEvent = timer.addEvent(MIN_FRAME_INTERVAL_MS, true, function () {
        var wait = animator.step();
        animationEvent.interval = Math.max(MIN_FRAME_INTERVAL_MS, wait);
    });
}

function startInputLoop() {
    if (inputEvent) inputEvent.abort = true;
    inputEvent = timer.addEvent(INPUT_POLL_INTERVAL, true, pollInput);
}

function languageName(code) {
    var choices = SignupI18n.choices();
    for (var i = 0; i < choices.length; i++) {
        if (choices[i].code === code) return choices[i].name;
    }
    return code || "English";
}

function renderLanguageScreen() {
    main.clear();
    var choices = SignupI18n.choices();
    var startY = 3;
    for (var i = 0; i < choices.length; i++) {
        main.gotoxy(20, startY + i * 2);
        main.putmsg("\1h\1w[" + choices[i].key + "]\1n " + choices[i].name);
    }
    main.draw();
}

function renderColorPrompt() {
    centerLine(speechBubbleText, tr("color.question", "do these look like 8 distinct shades - not blinking?"));
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
    var yesLabel = tr("color.yesButton", "[Y] Yes");
    var noLabel = tr("color.noButton", "[N] No");
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
    addHotspotForFrame(button, signupActionKey("key.yes", "Y"));
    addHotspotForFrame(button2, signupActionKey("key.no", "N"));
}

function renderExasciiPrompt() {
    button.clear(); button.close(); button = null; button2.clear(); button2.close(); button2 = null; main.cycle();
    centerLine(speechBubbleText, tr("font.question", "do these corners look tidy? [L/B]"));
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
    var yesLabel = tr("font.goodButton", "[L] Looks Good");
    var noLabel = tr("font.badButton", "[B] Broken");
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
    addHotspotForFrame(button, signupActionKey("key.fontGood", "L"));
    addHotspotForFrame(button2, signupActionKey("key.fontBad", "B"));
}

function resetBackspaceProgress() {
    backspaceBuffer = "";
    backspaceStage = "type";
}

function renderBackspaceScreen() {
    main.clear();
    main.gotoxy(3, 4);
    main.putmsg(tr("keyboard.type", "type: abc"));
    main.gotoxy(3, 6);
    main.putmsg(tr("keyboard.input", "input: "));
    updateBackspaceDisplay();
    main.draw();
}

function updateBackspaceDisplay() {
    main.gotoxy(11, 6);
    var shown = backspaceBuffer.length ? backspaceBuffer : tr("common.empty", "(empty)");
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
                centerLine(speechBubbleText, tr("keyboard.erase", "now backspace to erase it"));
                showTitle(tr("keyboard.title", "KEYBOARD TEST"));
            }
        }
    }
}

function renderAliasScreen() {
    main.clear();
    main.gotoxy(3, 4);
    main.putmsg(tr("alias.label", "alias: "));
    aliasBuffer = session.alias || "";
    updateAliasDisplay();
    main.draw();
}

function updateAliasDisplay() {
    main.gotoxy(11, 4);
    var shown = aliasBuffer.length ? aliasBuffer : tr("common.blank", "(blank)");
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
            showTitle(tr("alias.blankError", "alias can't be blank"));
            return;
        }
        if (aliasExists(trimmed)) {
            playAnimation(shakeAnim);
            centerLine(speechBubbleText, "\1h\1r" + tr("alias.usedError", "alias in use; pick another"));
            aliasBuffer = "";
            session.alias = "";
            updateAliasDisplay();
            return;
        }
        // The real name is derived from the handle, so a handle that cannot
        // produce a valid one (check_realname wants an alphabetic first
        // character, and rejects anything in name.can) has to be caught HERE.
        // Letting it through just files an account the audit flags anyway.
        if (!UserPolicy.deriveRealName(trimmed)) {
            playAnimation(shakeAnim);
            centerLine(speechBubbleText, "\1h\1r" + tr("alias.invalidError", "that one won't fly - start with a letter"));
            showTitle(tr("alias.pickAnother", "PICK ANOTHER NAME"));
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
    main.putmsg(isConfirm
        ? tr("password.confirmLabel", "confirm password:")
        : tr("password.label", "password:"));
    updatePasswordDisplay(isConfirm);
    main.draw();
}

function updatePasswordDisplay(isConfirm) {
    var buffer = isConfirm ? passwordConfirmBuffer : passwordBuffer;
    var placeholder = tr("common.blank", "(blank)");
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
        // Same rules the stock new-user flow applies, checked against the
        // string we will actually store (createAccountFromSession uppercases).
        var problem = UserPolicy.passwordProblem(passwordBuffer.toUpperCase(), signupIdentity());
        if (problem) {
            playAnimation(shakeAnim);
            var localizedProblem = localizeSignupError(problem);
            showTitle(localizedProblem);
            centerLine(speechBubbleText, "\1r" + localizedProblem);
            // Too short is fixable by typing more; the rest need a fresh
            // password, and blind-editing a masked field is no kindness.
            if (passwordBuffer.length >= UserPolicy.minPasswordLength()) {
                passwordBuffer = "";
                updatePasswordDisplay(false);
            }
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
            showTitle(tr("password.mismatch", "passwords do not match"));
            passwordBuffer = "";
            passwordConfirmBuffer = "";
            session.password = "";
            transitionTo("password_prompt");
            return;
        }
        passwordConfirmBuffer = "";
        playAnimation(nodAnim);
        if (!session.email) transitionTo("email_prompt");
        else transitionTo("location_prompt");
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
    main.putmsg(isConfirm ? tr("email.confirmLabel", "confirm email:") : tr("email.label", "email:"));
    updateEmailDisplay(isConfirm);
    main.draw();
}

function updateEmailDisplay(isConfirm) {
    var buffer = isConfirm ? emailConfirmBuffer : emailBuffer;
    var placeholder = tr("common.blank", "(blank)");
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
            showTitle(tr("email.invalid", "enter a valid email address"));
            return;
        }
        if (emailExists(trimmed)) {
            playAnimation(shakeAnim);
            centerLine(speechBubbleText, "\1h\1r" + tr("email.used", "that address is already registered"));
            showTitle(tr("email.usedTitle", "EMAIL ALREADY IN USE"));
            emailBuffer = "";
            session.email = "";
            updateEmailDisplay(false);
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
            showTitle(tr("email.mismatch", "email addresses do not match"));
            emailBuffer = "";
            emailConfirmBuffer = "";
            session.email = "";
            transitionTo("email_prompt");
            return;
        }
        emailConfirmBuffer = "";
        playAnimation(nodAnim);
        transitionTo("location_prompt");
        return;
    }
    if (code < 32) return;
    if (emailConfirmBuffer.length >= 48) return;
    emailConfirmBuffer += key;
    updateEmailDisplay(true);
}

function renderLocationScreen() {
    main.clear();
    main.gotoxy(3, 4);
    main.putmsg(tr("location.label", "location:"));
    updateLocationDisplay();
    main.draw();
}

function updateLocationDisplay() {
    main.gotoxy(3, 6);
    var shown = locationBuffer.length ? locationBuffer : tr("common.blank", "(blank)");
    var padded = shown + spaces(Math.max(0, 48 - shown.length));
    main.putmsg("\1h" + padded + "\1n");
    main.draw();
}

function handleLocationInput(key) {
    if (key.length !== 1) return;
    var code = key.charCodeAt(0);
    if (code === 8 || code === 127) {
        if (locationBuffer.length > 0) {
            locationBuffer = locationBuffer.substr(0, locationBuffer.length - 1);
            updateLocationDisplay();
        }
        return;
    }
    if (code === 10 || code === 13) {
        session.location = locationBuffer.trim();
        playAnimation(nodAnim);
        if (!session.email) transitionTo("email_prompt");
        else transitionTo("rules_prompt");
        return;
    }
    if (code < 32) return;
    if (locationBuffer.length >= 48) return;
    locationBuffer += key;
    updateLocationDisplay();
}

function renderRulesScreen() {
    main.clear();
    centerMain(tr("rules.copy", "keep it short. keep it kind. no spoilers in public."));
    centerMain("\1h\1w" + tr("rules.accept", "Accept? [Y]es / [N]o"), 2);
}

function boolLabel(val) {
    if (val === null) return "?";
    return val ? tr("common.yesLower", "yes") : tr("common.noLower", "no");
}

function renderConfirmSummary() {
    main.clear();
    main.gotoxy(3, 4);
    main.putmsg(tr("summary.language", "language: {value}", { value: languageName(session.lang) }));
    main.gotoxy(3, 5);
    main.putmsg(tr("summary.mouse", "mouse input: {value}", { value: boolLabel(session.mouse) }));
    main.gotoxy(3, 6);
    main.putmsg(tr("summary.color", "color depth: {value}", { value: boolLabel(session.color) }));
    main.gotoxy(3, 7);
    main.putmsg(tr("summary.exascii", "exascii: {value}", { value: boolLabel(session.exascii) }));
    main.gotoxy(3, 8);
    main.putmsg(tr("summary.backspace", "backspace: {value}", { value: boolLabel(session.backspace) }));
    main.gotoxy(3, 9);
    main.putmsg(tr("summary.rules", "rules ok: {value}", { value: boolLabel(session.rulesAccepted) }));
    main.gotoxy(3, 11);
    main.putmsg(tr("summary.alias", "alias: {value}", { value: "\1h" + (session.alias || tr("common.blank", "(blank)")) + "\1n" }));
    main.gotoxy(3, 12);
    main.putmsg(tr("summary.email", "email: {value}", { value: "\1h" + (session.email || tr("common.blank", "(blank)")) + "\1n" }));
    main.gotoxy(3, 13);
    main.putmsg(tr("summary.location", "location: {value}", { value: "\1h" + (session.location || tr("common.blank", "(blank)")) + "\1n" }));
    main.draw();
}

function renderDoneScreen() {
    main.clear();
    main.gotoxy(3, 5);
    main.putmsg(tr("done.alias", "alias registered: {value}", {
        value: "\1h" + (session.alias || tr("common.blank", "(blank)")) + "\1n"
    }));
    main.gotoxy(3, 7);
    main.putmsg(tr("done.email", "email on file: {value}", {
        value: "\1h" + (session.email || tr("common.blank", "(blank)")) + "\1n"
    }));
    if (MOCK_MODE) {
        main.gotoxy(3, 9);
        main.putmsg(tr("done.realName", "real name would be: {value}", {
            value: "\1h" + realNameFromAlias(session.alias) + "\1n"
        }));
        main.gotoxy(3, 11);
        main.putmsg("\1h\1y" + tr("done.mock", "mock run - no account was created") + "\1n");
    }
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
    log(LOG_INFO, format("future_signup alias=%s email=%s location=%s lang=%s %s",
        session.alias || "(blank)", session.email || "(blank)", session.location || "(blank)",
        session.lang || "en", flagsStr));
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
    language_prompt: {
        enter: function () {
            resetSession();
            centerLine(speechBubbleText, SignupI18n.choicePrompt());
            renderLanguageScreen();
            playAnimation(pointAnim);
            showTitle(SignupI18n.choiceTitle());
        }
    },
    welcome: {
        enter: function () {
            centerLine(speechBubbleText, tr("welcome.bubble", "hiya! i'll keep this fast. ready?"));
            main.clear();
            main.draw();
            playAnimation(idleAnim);
            showTitle('');
            centerMain(tr("welcome.begin", "press any key to begin."));
        }
    },
    mouse_prompt: {
        enter: function () {
            console.mouse_mode = true;
            seconds = MOUSE_TIMEOUT_MS / 1000;
            centerLine(speechBubbleText, tr("mouse.prompt",
                "click big button in {seconds} seconds for YES or press [N] now for 'no'.",
                { seconds: seconds }));
            main.clear();
            buttonWidth = main.width / 2;
            buttonY = main.height / 2 - statePrompt.height;
            var excess = parseInt((console.screen_columns - 80) / 2);
            button = new Frame(parseInt(main.width / 4) + excess, buttonY, buttonWidth, 5, BG_GREEN | WHITE, main);
            var clickLabel = tr("mouse.click", "[ CLICK HERE WITH MOUSE ]");
            var clickStart = ((main.width - clickLabel.length) / 2 | 0) + 1;
            // main.gotoxy(clickStart, 3);
            button.open();
            button.draw();
            button.drawBorder(BG_GREEN | WHITE);
            button.gotoxy(1, 3);
            button.center("\1h\1w" + clickLabel + "\1n");
            main.draw();

            buttonInterval = timer.addEvent(linkProfile.countdownMs, true, function () {
                // Cadence can change; the actual mouse-test deadline must not.
                seconds = Math.max(0, Math.ceil((MOUSE_TIMEOUT_MS - (clockMs() - stateStarted)) / 1000));
                button.gotoxy(button.width / 2, 2);
                var secStr = JSON.stringify(seconds);
                button.putmsg(secStr.length === 1 ? "0" + secStr : secStr);
                button.cycle();
            });
            addHotspotForFrame(button, "~");
            playAnimation(pointAnim);
            showTitle(tr("mouse.title", "MOUSE TEST"), [{ label: "press ~", cmd: "~" }]);
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
            centerLine(speechBubbleText, tr("mouse.success", "clicks working. sweet."));
            playAnimation(celebrateAnim);
            showTitle(tr("mouse.successTitle", "nice! moving on..."));
            scheduleStateEvent(REACTION_DELAY_MS, function () {
                transitionTo("color_prompt");
            });
        }
    },
    mouse_fail: {
        enter: function () {
            if (buttonInterval) buttonInterval.abort = true;
            session.mouse = false;
            // Stop mouse reporting so later clicks can't arrive as stray ESCs.
            // mouse_mode alone isn't enough: sbbs add_hotspot() calls
            // set_mouse(MOUSE_MODE_ON) again, so the next screen's buttons
            // re-arm reporting. Dropping USER_MOUSE from the detected terminal
            // flags makes add_hotspot a no-op for the rest of the session.
            console.mouse_mode = false;
            console.autoterm &= ~USER_MOUSE;
            centerLine(speechBubbleText, tr("mouse.fail", "no click? no prob. keys it is."));
            playAnimation(shrugAnim);
            showTitle(tr("mouse.failTitle", "keyboard it is"));
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
            showTitle(tr("color.title", "COLOR TEST"), [
                { label: tr("color.yesOption", "[Y] looks right"), cmd: signupActionKey("key.yes", "Y") },
                { label: tr("color.noOption", "[N] looks off"), cmd: signupActionKey("key.no", "N") }
            ]);
        }
    },
    color_yes: {
        enter: function () {
            session.color = true;
            centerLine(speechBubbleText, tr("color.success", "great!"));
            playAnimation(nodAnim);
            showTitle(tr("color.successTitle", "cool, next up..."));
            scheduleStateEvent(REACTION_DELAY_MS, function () {
                transitionTo("exascii_prompt");
            });
        }
    },
    color_no: {
        enter: function () {
            session.color = false;
            centerLine(speechBubbleText, tr("color.fail", "no worries, we'll adapt."));
            playAnimation(shakeAnim);
            showTitle(tr("color.failTitle", "thanks, logging it"));
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
            showTitle(tr("font.title", "FONT TEST"), [
                { label: tr("font.goodOption", "[L] tidy"), cmd: signupActionKey("key.fontGood", "L") },
                { label: tr("font.badOption", "[B] busted"), cmd: signupActionKey("key.fontBad", "B") }
            ]);
        }
    },
    exascii_ok: {
        enter: function () {
            centerLine(speechBubbleText, tr("font.success", "tidy corners. nice!"));
            playAnimation(nodAnim);
            showTitle(tr("font.successTitle", "noted"));
            scheduleStateEvent(REACTION_DELAY_MS, function () {
                transitionTo("backspace_prompt");
            });
        }
    },
    exascii_bad: {
        enter: function () {
            centerLine(speechBubbleText, tr("font.fail", "got it. we'll watch for glitches."));
            playAnimation(shakeAnim);
            showTitle(tr("font.failTitle", "we'll adjust"));
            scheduleStateEvent(REACTION_DELAY_MS, function () {
                transitionTo("backspace_prompt");
            });
        }
    },
    backspace_prompt: {
        enter: function () {
            button.clear(); button.close(); button = null; button2.clear(); button2.close(); button2 = null; main.cycle();
            session.backspace = false;
            centerLine(speechBubbleText, tr("keyboard.bubble", "type abc, then erase to empty."));
            playAnimation(thinkAnim);
            resetBackspaceProgress();
            renderBackspaceScreen();
            showTitle(tr("keyboard.title", "type the letters, then Backspace"));
        }
    },
    alias_prompt: {
        enter: function () {
            centerLine(speechBubbleText, tr("alias.bubble", "pick a name. we'll make it yours."));
            playAnimation(pointAnim);
            renderAliasScreen();
            showTitle(tr("alias.title", "USERNAME SELECTION"));
        }
    },
    password_prompt: {
        enter: function () {
            passwordBuffer = "";
            centerLine(speechBubbleText, tr("password.bubble", "Nice name, {alias}. Set a password.",
                { alias: "\1h\1w" + session.alias + "\1h\1y" }));
            playAnimation(thinkAnim);
            renderPasswordScreen(false);
            showTitle(tr("password.title", "SET PASSWORD"));
        }
    },
    password_confirm: {
        enter: function () {
            passwordConfirmBuffer = "";
            centerLine(speechBubbleText, tr("password.confirmBubble", "confirm password."));
            playAnimation(pointAnim);
            renderPasswordScreen(true);
            showTitle(tr("password.confirmTitle", "VERIFY PASSWORD"));
        }
    },
    email_prompt: {
        enter: function () {
            emailBuffer = session.email || "";
            centerLine(speechBubbleText, tr("email.bubble", "what's your email?"));
            playAnimation(thinkAnim);
            renderEmailScreen(false);
            showTitle(tr("email.title", "Recovery email address"));
        }
    },
    email_confirm: {
        enter: function () {
            emailConfirmBuffer = "";
            centerLine(speechBubbleText, tr("email.confirmBubble", "confirm email."));
            playAnimation(pointAnim);
            renderEmailScreen(true);
            showTitle(tr("email.confirmTitle", "CONFIRM EMAIL"));
        }
    },
    location_prompt: {
        enter: function () {
            locationBuffer = session.location || "";
            centerLine(speechBubbleText, tr("location.bubble", "where are you from? (optional)"));
            playAnimation(thinkAnim);
            renderLocationScreen();
            showTitle(tr("location.title", "LOCATION"));
        }
    },
    rules_prompt: {
        enter: function () {
            session.rulesAccepted = false;
            centerLine(speechBubbleText, tr("rules.bubble", "house rules-short + kind."));
            playAnimation(thinkAnim);
            renderRulesScreen();
            showTitle(tr("rules.title", "RULES"), [
                { label: tr("rules.yes", "[Y] I'm in"), cmd: signupActionKey("key.yes", "Y") },
                { label: tr("rules.no", "[N] tweak alias"), cmd: signupActionKey("key.no", "N") }
            ]);
        }
    },
    confirm_prompt: {
        enter: function () {
            session.confirmed = false;
            centerLine(speechBubbleText, tr("confirm.bubble", "all set? i'll file the paperwork."));
            playAnimation(thinkAnim);
            renderConfirmSummary();
            centerMain("\1h\1w" + tr("confirm.accept", "Accept? [Y]es / [N]o"), 2);
            showTitle(tr("confirm.title", "VERIFY DETAILS"), [
                { label: tr("confirm.yes", "[Y] confirm"), cmd: signupActionKey("key.yes", "Y") },
                { label: tr("confirm.no", "[N] edit alias"), cmd: signupActionKey("key.no", "N") }
            ]);
        }
    },
    done_prompt: {
        enter: function () {
            centerLine(speechBubbleText, tr("done.bubble", "welcome aboard."));
            playAnimation(celebrateAnim);
            renderDoneScreen();
            showTitle(tr("done.title", "SIGNUP COMPLETE"));
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
    // Un-patch frame.js and flatten the depth table: whatever runs next
    // inherits a terminal with no stale stereo depth on any layer.
    if (depthLayers) {
        try { depthLayers.dispose(); } catch (e) { }
        depthLayers = null;
    }
}

function mainLoop() {
    root.open();
    startAnimationLoop();
    startInputLoop();
    transitionTo("language_prompt");

    while (running && !js.terminated) {
        timer.cycle();
        mswait(TIMER_IDLE_DELAY);
    }

    cleanup();
    // Mock runs show the same closing screens but must not mail a "welcome"
    // to whoever is actually logged in (the sysop testing the flow).
    showStandardBBSStats(MOCK_MODE);
}

try {
    mainLoop();
} catch (err) {
    log(LOG_ERR, "future_signup failed: " + err);
    try { cleanup(); } catch (e) { }
    throw err;
}

if (pendingLogon && !js.terminated) {
    try {
        // User is already logged in from createAccountFromSession()
        // Just need to run the normal logon procedure
        log(LOG_INFO, 'future_signup: running logon procedure for ' + session.alias);
        // Switch Synchronet's native bbs.text table before any stock logon
        // prompts are emitted in the language selected before account creation.
        bbs.load_user_text();
        bbs.logon(); // Run normal logon procedure
    } catch (logonErr) {
        try { log(LOG_ERR, "future_signup logon failed: " + logonErr); } catch (_) { }
    }
    pendingLogon = false;
}
