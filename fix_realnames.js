/**
 * fix_realnames.js - backfill real names on existing accounts.
 *
 *   jsexec -c /sbbs/ctrl /sbbs/mods/future_signup/fix_realnames.js          # dry run
 *   jsexec -c /sbbs/ctrl /sbbs/mods/future_signup/fix_realnames.js apply    # writes
 *
 * chksetup's check_user_names() reports "has a disallowed name" for every
 * account whose real name fails system.check_realname(), which among other
 * things requires a space - so every account carrying a bare one-word handle
 * as its real name is flagged. This fills those in the same way the signup
 * wizard now does: the handle, doubled ("Freak" -> "Freak Freak").
 *
 * Deliberately conservative:
 *   - Dry run unless "apply" is passed. The dry run prints exactly what the
 *     apply would do.
 *   - "apply" copies data/user/user.tab and name.dat aside first. Synchronet's
 *     own nightly rotation (user.0.tab .. user.4.tab) is a second net.
 *   - Accounts already passing check_realname() are left alone. Passwords,
 *     aliases and every other field are never touched.
 *   - Deleted, inactive and guest accounts are skipped, exactly as chksetup
 *     skips them.
 *   - Users who are ONLINE right now are skipped and listed. A logged-on
 *     session holds its own copy of the record and writes it back at logoff,
 *     which would silently undo the change.
 *   - A handle that cannot yield a valid real name (check_realname also wants
 *     an alphabetic first character, and rejects anything in name.can) is
 *     reported for a human rather than papered over.
 */
load("sbbsdefs.js");
var UserPolicy = load("/sbbs/mods/load/user_policy.js");

function hasArg(name) {
    if (typeof argv === "undefined" || !argv) return false;
    for (var i = 0; i < argv.length; i++) {
        if (String(argv[i]).toLowerCase() === name) return true;
    }
    return false;
}
var APPLY = hasArg("apply");
/* Accounts whose real name is something other than their own handle had a
 * human type it. Held back by default so a partial real name is not traded for
 * a doubled handle without someone looking; "overwrite-typed" includes them. */
var OVERWRITE_TYPED = hasArg("overwrite-typed");

var USER_DIR = system.data_dir + "user/";
var BACKUP_FILES = ["user.tab", "name.dat"];

function backupUserData() {
    var stamp = strftime("%Y%m%d-%H%M%S", time());
    var made = [];
    for (var i = 0; i < BACKUP_FILES.length; i++) {
        var src = USER_DIR + BACKUP_FILES[i];
        if (!file_exists(src)) continue;
        var dest = src + ".realname-backup-" + stamp;
        if (!file_copy(src, dest)) {
            print("!! could not back up " + src + " -> aborting, nothing was changed");
            return null;
        }
        made.push(dest);
    }
    return made;
}

/** User numbers with a live session right now; their records are not ours. */
function onlineUserNumbers() {
    var online = {};
    try {
        for (var i = 0; i < system.node_list.length; i++) {
            var node = system.node_list[i];
            if (node.status !== NODE_INUSE && node.status !== NODE_LOGON && node.status !== NODE_QUIET)
                continue;
            if (node.useron > 0) online[node.useron] = true;
        }
    } catch (e) {
        print("!! could not read the node list: " + e);
    }
    return online;
}

var online = onlineUserNumbers();
var usr = new User;
var lastuser = system.lastuser;
var planned = [];       // {number, alias, from, to}
var skippedOnline = []; // {number, alias}
var unfixable = [];     // {number, alias, name}
var alreadyOk = 0;
var considered = 0;

for (var u = 1; u <= lastuser; u++) {
    usr.number = u;
    if (usr.settings & (USER_DELETED | USER_INACTIVE)) continue;
    if (usr.security.restrictions & UFLAG_G) continue;   // guests, as chksetup skips them
    considered++;
    var current = String(usr.name || "");
    if (typeof system.check_realname === "function" && system.check_realname(current)) {
        alreadyOk++;
        continue;
    }
    var proposed = UserPolicy.deriveRealName(usr.alias);
    if (!proposed) {
        unfixable.push({ number: u, alias: usr.alias, name: current });
        continue;
    }
    if (online[u]) {
        skippedOnline.push({ number: u, alias: usr.alias });
        continue;
    }
    planned.push({ number: u, alias: usr.alias, from: current, to: proposed });
}

print(APPLY ? "=== fix_realnames: APPLY ===" : "=== fix_realnames: DRY RUN (pass 'apply' to write) ===");
print(format("%u accounts considered, %u already valid", considered, alreadyOk));
print("");

// Names are derived from the HANDLE, as specified. Where the account already
// carries something other than its own handle, somebody typed that - it may be
// a partial real name worth keeping by hand instead ("Cindy" -> "Cindy Cindy"
// rather than "Cinder Cinder"). Split out BEFORE the counts are printed, so
// the numbers below say what will really be written.
var overwrites = [];
var willWrite = [];
for (var o = 0; o < planned.length; o++) {
    var cand = planned[o];
    if (cand.from.length && cand.from.toLowerCase() !== String(cand.alias).toLowerCase())
        overwrites.push(cand);
    else
        willWrite.push(cand);
}
if (OVERWRITE_TYPED) willWrite = planned;
planned = willWrite;

if (planned.length) {
    print(format("%u to update:", planned.length));
    for (var p = 0; p < planned.length; p++) {
        var row = planned[p];
        print(format("  #%-4u %-24s %-26s -> %s",
            row.number, row.alias, row.from.length ? '"' + row.from + '"' : "(blank)", '"' + row.to + '"'));
    }
    print("");
}

if (overwrites.length && !OVERWRITE_TYPED) {
    print(format("%u HELD BACK - these carry a name that is not just the handle:", overwrites.length));
    for (var ov = 0; ov < overwrites.length; ov++) {
        print(format("  #%-4u %-24s %-26s -> would become %s",
            overwrites[ov].number, overwrites[ov].alias,
            '"' + overwrites[ov].from + '"', '"' + overwrites[ov].to + '"'));
    }
    print("  (fix these by hand, or re-run with 'overwrite-typed' to take the derived name)");
    print("");
}

if (skippedOnline.length) {
    print(format("%u skipped - online right now, re-run when they log off:", skippedOnline.length));
    for (var s = 0; s < skippedOnline.length; s++)
        print(format("  #%-4u %s", skippedOnline[s].number, skippedOnline[s].alias));
    print("");
}

if (unfixable.length) {
    print(format("%u need a human - the handle cannot make a valid real name:", unfixable.length));
    for (var f = 0; f < unfixable.length; f++) {
        print(format("  #%-4u %-24s current name: %s",
            unfixable[f].number, unfixable[f].alias,
            unfixable[f].name.length ? '"' + unfixable[f].name + '"' : "(blank)"));
    }
    print("");
}

if (!APPLY) {
    print("Nothing was changed. Re-run with 'apply' to write these names.");
    exit(0);
}

if (!planned.length) {
    print("Nothing to write.");
    exit(0);
}

var backups = backupUserData();
if (backups === null) exit(1);
for (var b = 0; b < backups.length; b++) print("backed up: " + backups[b]);
print("");

var written = 0;
var failed = 0;
for (var w = 0; w < planned.length; w++) {
    var item = planned[w];
    try {
        usr.number = item.number;
        // Re-read: the dry-run pass and this one are not atomic, and the
        // account may have been touched (or logged on) in between.
        if (usr.settings & (USER_DELETED | USER_INACTIVE)) continue;
        if (typeof system.check_realname === "function" && system.check_realname(String(usr.name || "")))
            continue;
        usr.name = item.to;
        if (String(usr.name) !== item.to) {
            failed++;
            print(format("  !! #%-4u %s did not take the new name (read back: %s)",
                item.number, item.alias, JSON.stringify(String(usr.name))));
            continue;
        }
        written++;
    } catch (e) {
        failed++;
        print(format("  !! #%-4u %s failed: %s", item.number, item.alias, e));
    }
}

print("");
print(format("%u names written, %u failed.", written, failed));
if (written) {
    log(LOG_INFO, format("fix_realnames: backfilled %u real names", written));
    print("Re-run chksetup's check_user_names to confirm.");
}
exit(failed ? 1 : 0);
