/* UTF-8 locale loader for the pre-account Clippy flow. Returns CP437 bytes. */
(function () {
    "use strict";

    var BASE = "/sbbs/mods/future_signup/locales/";
    var utf8 = {};
    var cp437 = {};
    load(utf8, "utf8_utf16.js");
    load(cp437, "unicode_cp437.js");

    function readJson(path) {
        var file = new File(path);
        if (!file.open("rb", true)) return null;
        try {
            var decoded = utf8.utf8_utf16(file.read());
            if (decoded.charCodeAt(0) === 0xfeff) decoded = decoded.substr(1);
            return JSON.parse(decoded);
        } finally {
            file.close();
        }
    }

    function toCp437(value) {
        var text = String(value === undefined || value === null ? "" : value);
        var result = "";
        for (var i = 0; i < text.length; i++) {
            var code = text.charCodeAt(i);
            result += code < 0x80 ? text.charAt(i) : cp437.unicode_cp437(code);
        }
        return result;
    }

    function normalizedCode(value) {
        var code = String(value || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
        return code || "en";
    }

    function merge(target, source) {
        if (!source || !source.strings) return;
        for (var key in source.strings) {
            if (!source.strings.hasOwnProperty(key)) continue;
            var value = source.strings[key];
            if (typeof value === "string" && value.length) target[key] = toCp437(value);
        }
    }

    var english = readJson(BASE + "en.json") || { strings: {} };
    var index = readJson(BASE + "languages.json") || { prompt: "Choose your language", choices: [] };
    var activeCode = "en";
    var activeStrings = {};

    function activate(code) {
        var requested = normalizedCode(code);
        var selected = requested === "en" ? english : readJson(BASE + requested + ".json");
        activeStrings = {};
        merge(activeStrings, english);
        if (selected) merge(activeStrings, selected);
        activeCode = selected ? requested : "en";
        return activeCode;
    }

    function replaceParams(template, params) {
        if (!params) return template;
        return template.replace(/\{([A-Za-z0-9_.-]+)\}/g, function (whole, key) {
            return params.hasOwnProperty(key) ? String(params[key]) : whole;
        });
    }

    function text(key, fallback, params) {
        var value = activeStrings[key];
        if (value === undefined || value === null || value === "") value = fallback || "[missing:" + key + "]";
        return replaceParams(value, params);
    }

    function choices() {
        var result = [];
        var source = index.choices || [];
        for (var i = 0; i < source.length; i++) {
            var choice = source[i];
            if (!choice || !choice.code || !choice.key) continue;
            var code = normalizedCode(choice.code);
            if (code !== "en" && !file_exists(system.ctrl_dir + "text." + code + ".ini")) continue;
            if (!file_exists(BASE + code + ".json")) continue;
            result.push({ code: code, key: String(choice.key).toUpperCase(), name: toCp437(choice.name || code) });
        }
        return result;
    }

    activate("en");
    return {
        activate: activate,
        code: function () { return activeCode; },
        nativeUserLang: function () { return activeCode === "en" ? "" : activeCode; },
        text: text,
        choices: choices,
        choicePrompt: function () { return toCp437(index.prompt || "Choose your language"); },
        choiceTitle: function () { return toCp437(index.title || "LANGUAGE / IDIOMA / SPRACHE / LANGUE"); }
    };
})();
