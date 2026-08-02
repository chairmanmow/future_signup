// Regression harness for future_signup's non-interactive logic.
//
//   /sbbs/exec/jsexec -c /sbbs/ctrl /sbbs/mods/future_signup/test-signup.js
//
// Two things are checked, both against the SHIPPED source rather than a copy:
//   1. future_signup.js parses under Synchronet's engine (jsexec has no
//      console, so we stand one up short enough to trip the terminal-height
//      guard - the file is fully parsed before that check runs).
//   2. realNameFromAlias / emailExists behave, evaluated straight out of the
//      file so the test cannot drift from the implementation.
// jsexec has no `console`; frame.js needs one, so stand it up first and record
// everything the scene3d Display patch writes.
var console = {
    screen_columns: 80,
    screen_rows: 24,
    _out: '',
    _attr: undefined,
    cterm_version: 1332,
    write: function (s) { this._out += s; },
    gotoxy: function (x, y) { this._out += '\x1b[' + y + ';' + x + 'H'; },
    cleartoeol: function () { this._out += '\x1b[K'; },
    clear: function () { }
};
console.__defineSetter__('attributes', function (a) {
    this._attr = a;
    if (a !== undefined) this._out += '\x1b[' + a + 'm';
});
console.__defineGetter__('attributes', function () { return this._attr; });

load("sbbsdefs.js");
load("frame.js");

var fails = 0;
function eq(name, got, want) {
    if (String(got) !== String(want)) { fails++; print('FAIL ' + name + ': got ' + JSON.stringify(String(got)) + ' want ' + JSON.stringify(String(want))); }
    else print('ok   ' + name);
}

var SRC_PATH = "/sbbs/mods/future_signup/future_signup.js";
var f = new File(SRC_PATH);
if (!f.open("r")) { print("FAIL cannot read " + SRC_PATH); exit(1); }
var src = f.readAll().join("\n");
f.close();

/** Pull one top-level `function name(...) {...}` out of the source verbatim. */
function extractFunction(name) {
    var start = src.indexOf("\nfunction " + name + "(");
    if (start < 0) return null;
    var end = src.indexOf("\n}", start);
    if (end < 0) return null;
    return src.substring(start + 1, end + 2);
}

// --- shared account policy ------------------------------------------------
var UP = load("/sbbs/mods/load/user_policy.js");
eq("user_policy module loads", typeof UP, "object");
var realNameFromAlias = UP.realNameFromAlias;

eq("one-word handle is doubled", realNameFromAlias("Freak"), "Freak Freak");
eq("case is preserved", realNameFromAlias("xX_Zebra_Xx"), "xX_Zebra_Xx xX_Zebra_Xx");
eq("surrounding space trimmed", realNameFromAlias("  Freak  "), "Freak Freak");
eq("two-word handle kept as-is", realNameFromAlias("Doctor Doom"), "Doctor Doom");
eq("inner whitespace collapsed", realNameFromAlias("Doctor    Doom"), "Doctor Doom");
eq("blank handle yields blank", realNameFromAlias(""), "");
eq("undefined handle yields blank", realNameFromAlias(undefined), "");

// Long handles: never exceed LEN_NAME, and still read as two words.
var long13 = "Abcdefghijklm";              // 13 -> doubled is 27, over LEN_NAME (25)
var got13 = realNameFromAlias(long13);
eq("long handle fits LEN_NAME", got13.length <= LEN_NAME, "true");
eq("long handle still two words", got13.indexOf(" ") > 0, "true");
eq("long handle keeps full first word", got13.substr(0, long13.length), long13);

var long24 = "Abcdefghijklmnopqrstuvwx";   // 24 -> no room for a second word
var got24 = realNameFromAlias(long24);
eq("max-alias fits LEN_NAME", got24.length <= LEN_NAME, "true");

var exactly12 = "Abcdefghijkl";            // 12 -> doubled is exactly 25
eq("boundary handle doubles exactly", realNameFromAlias(exactly12), exactly12 + " " + exactly12);
eq("boundary handle is LEN_NAME", realNameFromAlias(exactly12).length, LEN_NAME);

// --- deriveRealName: the check_realname gate ------------------------------
// The derived name is worthless unless Synchronet accepts it, which is the
// difference between fixing the audit warning and re-creating it.
eq("doubled handle satisfies check_realname", UP.deriveRealName("Freak"), "Freak Freak");
eq("two-word handle passes through", UP.deriveRealName("Alex Corris"), "Alex Corris");
eq("digit-leading handle has no valid name", UP.deriveRealName("3vil"), "null");
eq("punctuation-leading handle has no valid name", UP.deriveRealName("_zed"), "null");
eq("hex-leading handle has no valid name", UP.deriveRealName("0xFFL1N3"), "null");
eq("blank handle has no valid name", UP.deriveRealName(""), "null");
// Whatever it returns, check_realname must agree - that is the whole contract.
var derivedSamples = ["Freak", "Alex Corris", "Y", "iNK$tAiN", "deepseaastronomy", "3vil", "_zed", ""];
var contractHeld = true;
for (var ds = 0; ds < derivedSamples.length; ds++) {
    var derived = UP.deriveRealName(derivedSamples[ds]);
    if (derived !== null && !system.check_realname(derived)) contractHeld = false;
}
eq("deriveRealName never returns a name check_realname rejects", contractHeld, "true");

// --- password policy ------------------------------------------------------
var minPw = UP.minPasswordLength();
var maxPw = UP.maxPasswordLength();
eq("min password length is at least the hard floor", minPw >= UP.MIN_PASS_LEN, "true");

var freak = { alias: "Freak", name: "Freak Freak", handle: "Freak" };
var zork = { alias: "Zork", name: "Zork Zork", handle: "Zork" };

eq("short password rejected", UP.passwordProblem("ABC", zork).indexOf("at least") >= 0, "true");
eq("empty password rejected", UP.passwordProblem("", zork) !== null, "true");
eq("password equal to the alias is obvious", UP.passwordProblem("FREAK", freak).indexOf("your name") >= 0, "true");
eq("password containing the alias is obvious",
    UP.passwordProblem("FREAK99", freak).indexOf("your name") >= 0, "true");
eq("password contained BY the alias is obvious",
    UP.passwordProblem("REAK", { alias: "Freakazoid" }).indexOf("your name") >= 0, "true");
eq("password built from the real name is obvious",
    UP.passwordProblem("ZORKZORK", zork).indexOf("your name") >= 0, "true");
// text/password.can - the same list chksetup reports "disallowed password" from.
eq("trashcanned password rejected", UP.passwordProblem("PASSWORD", zork) !== null, "true");
eq("a decent password is accepted", UP.passwordProblem("X7QM2P", zork), "null");
if (maxPw) {
    var tooLong = "";
    while (tooLong.length <= maxPw) tooLong += "QX7M2P";
    eq("over-long password rejected", UP.passwordProblem(tooLong, zork).indexOf("at most") >= 0, "true");
}

// Anything this accepts must also survive the checks chksetup runs later.
var pwSamples = ["X7QM2P", "QT4WZ9NM", "K3PLVR7X", "ABC", "PASSWORD", "FREAK", "AAAA"];
var pwContractHeld = true;
for (var ps = 0; ps < pwSamples.length; ps++) {
    var pw = pwSamples[ps];
    if (UP.passwordProblem(pw, zork) !== null) continue;   // rejected: chksetup never sees it
    if (pw.length < system.min_password_length) pwContractHeld = false;
    if (system.max_password_length && pw.length > system.max_password_length) pwContractHeld = false;
    if (!system.check_password(pw)) pwContractHeld = false;
    if (system.trashcan("password", pw)) pwContractHeld = false;
    if (zork.alias.toLowerCase() === pw.toLowerCase()) pwContractHeld = false;
    if (zork.name.toLowerCase() === pw.toLowerCase()) pwContractHeld = false;
    if (zork.handle.toLowerCase() === pw.toLowerCase()) pwContractHeld = false;
}
eq("accepted passwords all pass the chksetup checks", pwContractHeld, "true");

// --- emailExists ----------------------------------------------------------
var emailSrc = extractFunction("emailExists");
eq("emailExists found in source", emailSrc !== null, "true");
eval(emailSrc);
eq("blank address is never taken", emailExists(""), "false");
eq("null address is never taken", emailExists(null), "false");
// A real lookup against the live user base: this address should not exist.
eq("unused address is free", emailExists("nobody-" + LEN_NAME + "@example.invalid"), "false");

// --- pre-account localization --------------------------------------------
var I18n = load("/sbbs/mods/future_signup/signup_localization.js");
eq("signup localization module loads", typeof I18n, "object");
eq("all installed signup languages are offered", I18n.choices().length, 4);
eq("English maps to Synchronet default language", I18n.activate("en") + ":" + I18n.nativeUserLang(), "en:");
eq("Spanish maps to native text.es.ini", I18n.activate("es") + ":" + I18n.nativeUserLang(), "es:es");
eq("Spanish copy is converted to CP437", I18n.text("common.yesLower").charCodeAt(1), 0xa1);
eq("unknown language falls back to English", I18n.activate("xx"), "en");

function tr(key, fallback, params) { return I18n.text(key, fallback, params); }
var localizedErrorSrc = extractFunction("localizeSignupError");
eq("localized signup error helper found", localizedErrorSrc !== null, "true");
eval(localizedErrorSrc);
I18n.activate("es");
eq("password validation feedback is localized",
    localizeSignupError("password must be at least 6 characters"),
    "la contrase\xA4a debe tener al menos 6 caracteres");
I18n.activate("en");

eq("language picker is the initial state", src.indexOf('transitionTo("language_prompt")') >= 0, "true");
eq("selected language is persisted to the user", src.indexOf("user.lang = SignupI18n.nativeUserLang()") >= 0, "true");
var languageWriteAt = src.indexOf("user.lang = SignupI18n.nativeUserLang()");
eq("language write precedes user sync", languageWriteAt < src.indexOf("bbs.user_sync();", languageWriteAt), "true");
var mockGateAt = src.indexOf("if (MOCK_MODE) {", src.indexOf("function createAccountFromSession"));
eq("mock mode returns before new_user", mockGateAt < src.indexOf("system.new_user", mockGateAt), "true");
eq("native text reload precedes stock logon", src.indexOf("bbs.load_user_text();") < src.indexOf("bbs.logon(); // Run normal logon procedure"), "true");

// Every translation deliberately covers the complete English signup keyset;
// no language silently falls back for a forgotten prompt.
var utf8Scope = {};
load(utf8Scope, "utf8_utf16.js");
function readLocale(code) {
    var lf = new File("/sbbs/mods/future_signup/locales/" + code + ".json");
    if (!lf.open("rb", true)) return null;
    var value = JSON.parse(utf8Scope.utf8_utf16(lf.read()));
    lf.close();
    return value;
}
var baseLocale = readLocale("en");
var localeCodes = ["de", "es", "fr"];
var localeParity = true;
for (var lc = 0; lc < localeCodes.length; lc++) {
    var translatedLocale = readLocale(localeCodes[lc]);
    for (var localeKey in baseLocale.strings) {
        if (!baseLocale.strings.hasOwnProperty(localeKey)) continue;
        if (!translatedLocale || typeof translatedLocale.strings[localeKey] !== "string") localeParity = false;
    }
}
eq("translated signup locales cover every English key", localeParity, "true");

// --- 3dBBS depth policy ---------------------------------------------------
// The band table and the policy both come out of the shipped source, so this
// tests what actually runs. The ancestry ORDER is the fragile part: the speech
// bubble, its text and the buttons are all descendants of `main`, and the
// sprite pane is a child of the container, so each has to match as itself
// before the walk reaches its parent and bands it with the surface behind it.
var orderSrc = /var DEPTH_BAND_ORDER = \[[^\]]*\];/.exec(src);
var bandsSrc = /var DEPTH_BANDS = \{[\s\S]*?\n\};/.exec(src);
eq("band order found in source", orderSrc !== null, "true");
eq("band depths found in source", bandsSrc !== null, "true");
eval(orderSrc[0]);
eval(bandsSrc[0]);

// Layer 0 is where everything written outside the frame diff lands, so the
// nearest band has to be the one that owns it - and the ramp must not fold.
eq("layer 0 is the glass", DEPTH_BAND_ORDER[0], "glass");
eq("glass band is depth 0", DEPTH_BANDS[DEPTH_BAND_ORDER[0]], 0);
var monotonic = true;
for (var bi = 1; bi < DEPTH_BAND_ORDER.length; bi++) {
    if (!(DEPTH_BANDS[DEPTH_BAND_ORDER[bi]] > DEPTH_BANDS[DEPTH_BAND_ORDER[bi - 1]])) monotonic = false;
}
eq("bands run strictly near to far", monotonic, "true");
eq("bands fit the 16 client layers", DEPTH_BAND_ORDER.length <= 16, "true");

// A signup-shaped frame tree, named exactly as the policy expects.
var root = new Frame(1, 1, 80, 24, BG_BLACK | LIGHTGRAY); root.open();
var centeredContainer = new Frame(1, 1, 80, 24, BG_LIGHTGRAY | BLACK, root); centeredContainer.open();
var statePrompt = new Frame(1, 1, 80, 3, BG_CYAN | WHITE, centeredContainer); statePrompt.open();
var main = new Frame(1, 4, 80, 21, BG_BLUE | WHITE, centeredContainer); main.open();
var spritePane = new Frame(64, 17, 14, 7, BG_GREEN | LIGHTGRAY, centeredContainer); spritePane.open();
var speechBubble = new Frame(24, 14, 40, 5, BG_BLACK | BLACK, main); speechBubble.open();
var speechBubbleText = new Frame(26, 15, 36, 3, BG_BLACK | YELLOW, speechBubble); speechBubbleText.open();
var button = new Frame(10, 8, 20, 3, BG_GREEN | LIGHTGRAY, main); button.open();
var button2 = new Frame(40, 8, 20, 3, BG_RED | LIGHTGRAY, main); button2.open();
var strayInMain = new Frame(3, 6, 6, 1, BG_BLUE | WHITE, main); strayInMain.open();

var policySrc = extractFunction("depthBandFor");
eq("depthBandFor found in source", policySrc !== null, "true");
eval(policySrc);

eq("CLIPPY is at the glass", depthBandFor(spritePane), "glass");
eq("speech bubble beats its parent pane", depthBandFor(speechBubble), "bubble");
eq("bubble text rides the bubble two hops up", depthBandFor(speechBubbleText), "bubble");
eq("button beats its parent pane", depthBandFor(button), "button");
eq("second button too", depthBandFor(button2), "button");
eq("title bar is chrome", depthBandFor(statePrompt), "chrome");
eq("main pane is content", depthBandFor(main), "content");
eq("unknown child of main bands with main", depthBandFor(strayInMain), "content");
eq("container is the panel", depthBandFor(centeredContainer), "panel");
eq("root is the backdrop", depthBandFor(root), "backdrop");

// Buttons are closed and nulled between states; the policy still has to band
// the rest of the pane without matching (or throwing on) the null.
var savedButton = button, savedButton2 = button2;
button = null; button2 = null;
eq("nulled buttons leave the pane banding intact", depthBandFor(strayInMain), "content");
eq("nulled buttons do not swallow the container", depthBandFor(centeredContainer), "panel");
button = savedButton; button2 = savedButton2;

// End to end: paint, then read back the layer each glyph was written at.
var S3 = load("/sbbs/mods/load/scene3d.js");
var layers = new S3.TextDepthLayers({
    spread: 4, order: DEPTH_BAND_ORDER, depths: DEPTH_BANDS, bandFor: depthBandFor
});
eq("depth layers install", layers.install(Display), "true");

console._out = '';
spritePane.gotoxy(1, 1); spritePane.putmsg('SSSS');
speechBubbleText.gotoxy(1, 1); speechBubbleText.putmsg('BBBB');
button.gotoxy(2, 2); button.putmsg('KKKK');
statePrompt.gotoxy(1, 1); statePrompt.putmsg('TTTT');
main.gotoxy(1, 1); main.putmsg('MMMM');
root.cycle();

/** Walk the stream tracking CSI = Ps z; return {char: layer} for our markers. */
function layersOf(stream) {
    var seen = {};
    var layer = 0;
    var i = 0;
    while (i < stream.length) {
        var c = stream.charAt(i);
        if (c === '\x1b') {
            var m = /^\x1b\[([0-9;=]*)([a-zA-Z*@])/.exec(stream.substring(i));
            if (m) {
                var sel = /^=([0-9]+)$/.exec(m[1]);
                if (sel && m[2] === 'z') layer = parseInt(sel[1], 10);
                i += m[0].length;
                continue;
            }
            i++;
            continue;
        }
        if (c >= 'A' && c <= 'Z') {
            if (seen[c] === undefined) seen[c] = layer;
            else if (seen[c] !== layer) seen[c] = 'MIXED(' + seen[c] + ',' + layer + ')';
        }
        i++;
    }
    return seen;
}

var painted = layersOf(console._out);
eq("CLIPPY renders at layer 0", painted['S'], 0);
eq("his bubble sits just behind him", painted['B'], DEPTH_BAND_ORDER.indexOf('bubble'));
eq("buttons float above the form", painted['K'], DEPTH_BAND_ORDER.indexOf('button'));
eq("title bar at chrome depth", painted['T'], DEPTH_BAND_ORDER.indexOf('chrome'));
eq("main pane behind all of it", painted['M'], DEPTH_BAND_ORDER.indexOf('content'));
eq("CLIPPY is nearer than everything else",
    (painted['S'] < painted['B'] && painted['B'] < painted['K']
        && painted['K'] < painted['T'] && painted['T'] < painted['M']), "true");
eq("stream returns to the glass", /\x1b\[=0z$/.test(console._out), "true");
layers.dispose();

print(fails ? ('FAILED ' + fails) : 'ALL SIGNUP LOGIC TESTS PASSED');
if (fails) exit(1);

// --- the whole file parses ------------------------------------------------
// Last, because it cannot return: with a terminal shorter than the wizard's
// minimum the module prints, waits and calls exit() - which ends this process
// too - but only after the engine has parsed every line of the file. So a
// clean finish here means it parsed; a SyntaxError prints PARSE FAILED first.
print("parse check (silence past this line means it parsed)...");
try {
    load({
        console: {
            screen_columns: 80, screen_rows: 10, autoterm: 0,
            clear: function () { }, writeln: function () { }, write: function () { }
        }
    }, SRC_PATH);
} catch (e) {
    print("PARSE FAILED: " + e);
    exit(1);
}
exit(0);
