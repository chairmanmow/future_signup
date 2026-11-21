/* Read-only animation/wire-cost harness, using the real Frame renderer and
   shipped sprite sheet. No signup, terminal connection or user writes.
   Run: /sbbs/repo/exec/jsexec -C -c/sbbs/ctrl -i/sbbs/exec/load
        /sbbs/mods/future_signup/test-animation.js */
var console = {
    screen_columns: 80, screen_rows: 24, _out: '', _attr: 7,
    write: function (s) { this._out += s; },
    gotoxy: function (x, y) { this.write('\x1b[' + y + ';' + x + 'H'); },
    cleartoeol: function () { this.write('\x1b[K'); }
};
load('sbbsdefs.js');
load('frame.js');
var Ansi = load({}, 'ansiterm_lib.js');
console.__defineGetter__('attributes', function () { return this._attr; });
console.__defineSetter__('attributes', function (attr) {
    if (attr !== undefined) {
        this.write(Ansi.attr(attr, this._attr));
        this._attr = attr;
    }
});

var MOD_DIR = '/sbbs/mods/future_signup/';
var MIN_FRAME_INTERVAL_MS = 100;
var DEFAULT_ATTR = WHITE | BG_BLUE;
var file = new File(MOD_DIR + 'future_signup.js');
if (!file.open('r')) throw new Error('Cannot read signup source');
var source = file.read(); file.close();
var start = source.indexOf('\nfunction clockMs(');
var end = source.indexOf('/* ========================= UI helpers', start);
if (start < 0 || end < start) throw new Error('Cannot locate sprite implementation');
eval(source.substring(start, end));
if (!Frame.prototype.makeContentTransparent) Frame.prototype.makeContentTransparent = function () { this.transparent = true; };

var def = loadSpriteDefinition(MOD_DIR + 'paperclip.sprite.json');
var sprites = loadSpriteFrames(resolveSpriteSource(def), def.frameSize[0], def.frameSize[1]);
var anims = buildAnimations(def, sprites.frames.length);

// Reference path from before the refactor. Clear invalidates the display's
// diff buffer, forcing the whole 16x8 sprite onto the wire every tick.
function legacyDraw(pane, frame) {
    pane.clear();
    for (var r = 0; r < frame.length; r++) {
        pane.gotoxy(1, 1 + r);
        for (var c = 0; c < frame[r].length; c++) pane.putmsg(frame[r][c].ch, frame[r][c].attr);
    }
    pane.draw();
}

function makePane() {
    var root = new Frame(1, 1, 80, 24, BG_BLUE | WHITE);
    var pane = new Frame(64, 17, def.frameSize[0], def.frameSize[1], BG_GREEN | LIGHTGRAY, root);
    pane.transparent = true;
    root.open(); root.cycle();
    return { root: root, pane: pane };
}

function wireCost(draw, animation) {
    var ui = makePane();
    var spec = anims.map[animation];
    draw(ui.pane, sprites.frames[spec.frames[0]]);
    console._out = '';
    // Four whole cycles average out differences between individual frames.
    for (var i = 1; i <= spec.frames.length * 4; i++) draw(ui.pane, sprites.frames[spec.frames[i % spec.frames.length]]);
    var bytes = console._out.length;
    var elapsed = spec.frames.length * 4 * spec.speed;
    ui.root.close();
    return { bytes: bytes, bytesPerSecond: bytes * 1000 / elapsed };
}

print('ANSI wire estimate (real Frame + sprite data; no Telnet/probe overhead):');
for (var name in anims.map) {
    if (!anims.map.hasOwnProperty(name)) continue;
    var before = wireCost(legacyDraw, name);
    var after = wireCost(drawFrameToPane, name);
    print(name + ': legacy ' + Math.round(before.bytesPerSecond) + ' B/s -> current ' +
        Math.round(after.bytesPerSecond) + ' B/s, ' + Math.round(100 * (1 - after.bytes / before.bytes)) + '% less');
}

var failures = 0;
function check(name, ok) {
    if (!ok) failures++;
    print((ok ? 'PASS: ' : 'FAIL: ') + name);
}
function snapshot(pane) {
    var cells = [];
    for (var y = 0; y < def.frameSize[1]; y++) for (var x = 0; x < def.frameSize[0]; x++) {
        var d = pane.getData(x, y, false);
        cells.push([d.ch, d.attr || pane.attr]);
    }
    return JSON.stringify(cells);
}
var oldUI = makePane(), newUI = makePane();
var identical = true;
for (var frame = 0; frame < sprites.frames.length; frame++) {
    legacyDraw(oldUI.pane, sprites.frames[frame]);
    drawFrameToPane(newUI.pane, sprites.frames[frame]);
    if (snapshot(oldUI.pane) !== snapshot(newUI.pane)) identical = false;
}
check('every sprite frame has the same characters/colors as before', identical);
console._out = '';
drawFrameToPane(newUI.pane, sprites.frames[sprites.frames.length - 1]);
check('drawing the same frame twice sends zero bytes', console._out.length === 0);
newUI.root.cycle();
check('sprite updates leave no unrelated display cells pending', console._out.length === 0);
oldUI.root.close(); newUI.root.close();

function functionSource(name) {
    var a = source.indexOf('\nfunction ' + name + '(');
    var b = source.indexOf('\n}', a);
    if (a < 0 || b < a) throw new Error('Cannot locate ' + name);
    return source.substring(a + 1, b + 2);
}
function profileFor(kbps) {
    var cached = kbps === null ? null : { kbps: kbps, source: 'test' };
    var meter = load({ bbs: { mods: { link_speed: cached } }, console: {
        getxy: function () { throw new Error('A cached reading must not re-probe'); }
    } }, '/sbbs/mods/load/linkspeed.js');
    return new Function('load', 'log', 'LOG_WARNING', 'MIN_FRAME_INTERVAL_MS',
        functionSource('signupLinkProfile') + '\nreturn signupLinkProfile();'
    )(function () { return meter; }, function () {}, 1, MIN_FRAME_INTERVAL_MS);
}
var modemRates = [0.12, 0.48, 1.44, 2.88, 5.6, 7.99];
for (var rate = 0; rate < modemRates.length; rate++) {
    check('shared meter selects static at ' + modemRates[rate] + ' KB/s', profileFor(modemRates[rate]).tier === 'static');
}
check('8 KB/s selects lite', profileFor(8).tier === 'lite');
check('39.99 KB/s selects lite', profileFor(39.99).tier === 'lite');
check('40 KB/s selects full', profileFor(40).tier === 'full');
check('unknown cached reading preserves full behavior', profileFor(null).tier === 'full');
var unavailable = new Function('load', 'log', 'LOG_WARNING', 'MIN_FRAME_INTERVAL_MS',
    functionSource('signupLinkProfile') + '\nreturn signupLinkProfile();'
)(function () { throw new Error('unavailable'); }, function () {}, 1, MIN_FRAME_INTERVAL_MS);
check('missing meter preserves full behavior', unavailable.tier === 'full');

var still = makePane();
var staticAnimator = new SpriteAnimator(still.pane, sprites.frames, anims.map, 'idle', profileFor(1.44));
staticAnimator.play('idle', 0);
var firstPose = snapshot(still.pane);
console._out = '';
for (var now = 100; now <= 60000; now += 100) staticAnimator.step(now);
check('modem mode produces no idle traffic for 60 simulated seconds', console._out.length === 0);
check('static mode retains Clippy on screen', snapshot(still.pane) === firstPose);
staticAnimator.play('think', 60000);
check('static Clippy still changes pose with the signup step', snapshot(still.pane) !== firstPose);
still.root.close();

var light = makePane();
var liteAnimator = new SpriteAnimator(light.pane, sprites.frames, anims.map, 'idle', profileFor(20));
liteAnimator.play('idle', 0);
console._out = '';
liteAnimator.step(799);
check('lite mode waits at least 800ms between frames', console._out.length === 0);
liteAnimator.step(800);
check('lite mode still animates', console._out.length > 0);
liteAnimator.noteInput(850);
console._out = '';
liteAnimator.step(2800);
check('typing holds lite animation quiet for two seconds', console._out.length === 0);
liteAnimator.play('think', 900);
console._out = '';
liteAnimator.step(3600);
check('changing signup step does not bypass the typing pause', console._out.length === 0);
liteAnimator.step(3650);
check('animation resumes after typing has settled', console._out.length > 0);
light.root.close();

var fast = makePane();
var fullAnimator = new SpriteAnimator(fast.pane, sprites.frames, anims.map, 'idle', profileFor(100));
fullAnimator.play('idle', 0);
console._out = '';
fullAnimator.step(199);
check('full idle retains the original 200ms interval', console._out.length === 0);
fullAnimator.step(200);
check('full idle advances at the original deadline', console._out.length > 0 && fullAnimator.cursor === 1);
fullAnimator.play('celebrate', 1000);
fullAnimator.noteInput(1100);
check('fast links are not slowed by the lite typing pause', fullAnimator.nextTick === 1150);
fullAnimator.step(1150);
check('full reactions retain the original 150ms interval', fullAnimator.cursor === 1);
fast.root.close();

var scheduled = [];
var timer = { addEvent: function (interval, repeat, action) {
    var event = { interval: interval, repeat: repeat, action: action };
    scheduled.push(event); return event;
} };
var animationEvent = { abort: false }, previousEvent = animationEvent;
var linkProfile = profileFor(1.44), animator = staticAnimator;
eval(functionSource('startAnimationLoop'));
startAnimationLoop();
check('static mode schedules no repeating animation timer', scheduled.length === 0 && animationEvent === null && previousEvent.abort);
linkProfile = profileFor(20); animator = liteAnimator;
startAnimationLoop();
check('lite mode keeps an animation timer', scheduled.length === 1 && animationEvent.repeat === true);
check('input polling interval remains independent of animation', /const INPUT_POLL_INTERVAL = 75;/.test(source));
check('mouse-test deadline remains 30 seconds', /const MOUSE_TIMEOUT_MS = 30000;/.test(source));
check('mouse countdown is less chatty on slower links', profileFor(1.44).countdownMs === 5000 && profileFor(20).countdownMs === 2000 && profileFor(100).countdownMs === 1000);

function animatorCost(profile, name) {
    var ui = makePane();
    var a = new SpriteAnimator(ui.pane, sprites.frames, anims.map, 'idle', profile);
    a.play(name, 0);
    console._out = '';
    for (var now = 100; now <= 60000; now += 100) a.step(now);
    var bps = console._out.length / 60;
    ui.root.close();
    return bps;
}
var maxLite = 0;
for (var name in anims.map) if (anims.map.hasOwnProperty(name)) maxLite = Math.max(maxLite, animatorCost(profileFor(20), name));
print('60s simulation: static 0 B/s idle, lite worst-case ' + Math.round(maxLite) + ' B/s');
check('lite animation stays under 0.5 KB/s for every shipped animation', maxLite < 500);
if (failures) throw new Error(failures + ' animation checks failed');
print('ALL SIGNUP ANIMATION TESTS PASSED (no accounts created)');
