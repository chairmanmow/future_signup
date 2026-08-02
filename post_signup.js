load("sbbsdefs.js");


// skipWelcomeMail: mock/dry runs still show the closing screens, but must not
// mail a new-user welcome to whoever is actually logged in. Omitted = send.
function showStandardBBSStats(skipWelcomeMail) {
    if (!skipWelcomeMail) sendWelcomeMessage(user);
    console.clear();

    console.printfile(system.text_dir + "sbbs.msg", P_NOABORT);
    if (console.line_counter)
        console.pause();
    console.clear();
    console.printfile(system.text_dir + "system.msg", P_NOABORT);
    if (console.line_counter)
        console.pause();
    console.clear();
    console.printfile(system.text_dir + "newuser.msg", P_NOABORT);
    if (console.line_counter)
        console.pause();
    console.clear();
}

function sendWelcomeMessage(user) {
    welcome_msg = system.text_dir + "welcome.msg";
    if (file_exists(welcome_msg) && user.number > 1) {
        if (send_newuser_welcome_msg(welcome_msg))
            log(LOG_INFO, "Sent new user welcome e-mail");
    }

}

function send_newuser_welcome_msg(fname) {
    file = new File(fname);
    if (!file.open("rt")) {
        log(LOG_ERR, "!ERROR " + errno_str + " opening " + fname);
        return (false);
    }
    msgtxt = lfexpand(file.read(file.length));
    file.close();
    file = null;

    msgbase = new MsgBase("mail");
    if (msgbase.open() == false) {
        log(LOG_ERR, "!ERROR " + msgbase.error);
        return (false);
    }

    hdr = {
        to: user.alias,
        to_ext: String(user.number),
        from: system.operator,
        from_ext: "1",
        attr: MSG_KILLREAD,
        subject: "Welcome to " + system.name + "!"
    };

    msgtxt = msgtxt.replace(/@(\w+)@/g, function (code) { return bbs.atcode(code.slice(1, -1)); });
    var result = msgbase.save_msg(hdr, msgtxt);
    if (!result)
        log(LOG_ERR, "!ERROR " + msgbase.error + " saving mail message");

    msgbase.close();
    return result;
}
