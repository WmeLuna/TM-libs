// IN ABSOLUTELY NO WAY IS THIS MINE
// ive modified vencords patching code to be used in tampermonkey scripts
// patches work the same way as vencord except for each patch .plugin is required
// @grant none MUST be enabled to use this as window would be different if not

// @require      https://cdn.jsdelivr.net/npm/diff/dist/diff.min.js
// @require      https://raw.githubusercontent.com/WmeLuna/TM-libs/main/VenPatch.js
// @grant        none

let WEBPACK_CHUNK = Object.keys(window).find((key) => key.startsWith("webpackChunk"));
let cache, wreq, webpackChunk
var traces = {}
let IS_DEV = true
const logger = console
function canonicalizeReplace(replace, pluginName) {
    const self = `Vencord.Plugins.plugins[${JSON.stringify(pluginName)}]`;

    if (typeof replace !== "function")
        return replace.replaceAll("$self", self);

    return (...args) => replace(...args).replaceAll("$self", self);
}

function canonicalizeDescriptor(descriptor, canonicalize) {
    if (descriptor.get) {
        const original = descriptor.get;
        descriptor.get = function () {
            return canonicalize(original.call(this));
        };
    } else if (descriptor.value) {
        descriptor.value = canonicalize(descriptor.value);
    }
    return descriptor;
}

function canonicalizeMatch(match) {
    if (typeof match === "string") return match;
    const canonSource = match.source
        .replaceAll("\\i", "[A-Za-z_$][\\w$]*");
    return new RegExp(canonSource, match.flags);
}

function canonicalizeReplacement(replacement, plugin) {
    const descriptors = Object.getOwnPropertyDescriptors(replacement);
    descriptors.match = canonicalizeDescriptor(descriptors.match, canonicalizeMatch);
    descriptors.replace = canonicalizeDescriptor(
        descriptors.replace,
        replace => canonicalizeReplace(replace, plugin),
    );
    Object.defineProperties(replacement, descriptors);
}
function _initWebpack(instance) {
    if (cache !== void 0) throw "no.";

    wreq = instance.push([[Symbol("Vencord")], {}, r => r]);
    cache = wreq.c;
    instance.pop();
}

function beginTrace(name, ...args) {
    if (name in traces)
        throw new Error(`Trace ${name} already exists!`);
    traces[name] = [performance.now(), args];
}
function finishTrace(name) {
    const end = performance.now();

    const [start, args] = traces[name];
    delete traces[name];

    logger.debug(`${name} took ${end - start}ms`, args);
}
const traceFunction = function traceFunction(name, f, mapper) {
        return function (...args) {
            const traceName = mapper?.(...args) ?? name;

            beginTrace(traceName, ...arguments);
            try {
                return f.apply(this, args);
            } finally {
                finishTrace(traceName);
            }
        }
    };

if (window[WEBPACK_CHUNK]) {
    logger.info(`Patching ${WEBPACK_CHUNK}.push (was already existant, likely from cache!)`);
    _initWebpack(window[WEBPACK_CHUNK]);
    patchPush();
} else {
    Object.defineProperty(window, WEBPACK_CHUNK, {
        get: () => webpackChunk,
        set: v => {
            if (v?.push !== Array.prototype.push) {
                logger.info(`Patching ${WEBPACK_CHUNK}.push`);
                _initWebpack(v);
                patchPush();
                // @ts-ignore
                delete window[WEBPACK_CHUNK];
                window[WEBPACK_CHUNK] = v;
            }
            webpackChunk = v;
        },
        configurable: true
    });
}

function patchPush() {
    function handlePush(chunk) {
        try {
            const modules = chunk[1];
            const subscriptions = new Map()
            const listeners = new Set()

            for (const id in modules) {
                let mod = modules[id];
                // Discords Webpack chunks for some ungodly reason contain random
                // newlines. Cyn recommended this workaround and it seems to work fine,
                // however this could potentially break code, so if anything goes weird,
                // this is probably why.
                // Additionally, `[actual newline]` is one less char than "\n", so if Discord
                // ever targets newer browsers, the minifier could potentially use this trick and
                // cause issues.
                let code = mod.toString().replaceAll("\n", "");
                // a very small minority of modules use function() instead of arrow functions,
                // but, unnamed toplevel functions aren't valid. However 0, function() makes it a statement
                if (code.startsWith("function(")) {
                    code = "0," + code;
                }
                const originalMod = mod;
                const patchedBy = new Set();

                const factory = modules[id] = function (module, exports, require) {
                    try {
                        mod(module, exports, require);
                    } catch (err) {
                        // Just rethrow discord errors
                        if (mod === originalMod) throw err;

                        logger.error("Error in patched chunk", err);
                        return void originalMod(module, exports, require);
                    }

                    const numberId = Number(id);

                    for (const callback of listeners) {
                        try {
                            callback(exports, numberId);
                        } catch (err) {
                            logger.error("Error in webpack listener", err);
                        }
                    }

                    for (const [filter, callback] of subscriptions) {
                        try {
                            if (filter(exports)) {
                                subscriptions.delete(filter);
                                callback(exports, numberId);
                            } else if (typeof exports === "object") {
                                if (exports.default && filter(exports.default)) {
                                    subscriptions.delete(filter);
                                    callback(exports.default, numberId);
                                }

                                for (const nested in exports) if (nested.length <= 3) {
                                    if (exports[nested] && filter(exports[nested])) {
                                        subscriptions.delete(filter);
                                        callback(exports[nested], numberId);
                                    }
                                }
                            }
                        } catch (err) {
                            logger.error("Error while firing callback for webpack chunk", err);
                        }
                    }
                }

                // for some reason throws some error on which calling .toString() leads to infinite recursion
                // when you force load all chunks???
                try {
                    factory.toString = () => mod.toString();
                    factory.original = originalMod;
                } catch { /* */ }

                for (let i = 0; i < patches.length; i++) {
                    const patch = patches[i];
                    const executePatch = traceFunction(`patch by ${patch.plugin}`, (match, replace) => code.replace(match, replace));
                    if (patch.predicate && !patch.predicate()) continue;

                    if (code.includes(patch.find)) {
                        patchedBy.add(patch.plugin);

                        // we change all patch.replacement to array in plugins/index
                        for (const replacement of patch.replacement) {
                            if (replacement.predicate && !replacement.predicate()) continue;
                            const lastMod = mod;
                            const lastCode = code;

                            canonicalizeReplacement(replacement, patch.plugin);

                            try {
                                const newCode = executePatch(replacement.match, replacement.replace);
                                if (newCode === code && !patch.noWarn) {
                                    logger.warn(`Patch by ${patch.plugin} had no effect (Module id is ${id}): ${replacement.match}`);
                                    if (IS_DEV) {
                                        logger.debug("Function Source:\n", code);
                                    }
                                } else {
                                    code = newCode;
                                    mod = (0, eval)(`// Webpack Module ${id} - Patched by ${[...patchedBy].join(", ")}\n${newCode}\n//# sourceURL=WebpackModule${id}`);
                                }
                            } catch (err) {
                                logger.error(`Patch by ${patch.plugin} errored (Module id is ${id}): ${replacement.match}\n`, err);

                                if (IS_DEV) {
                                    const changeSize = code.length - lastCode.length;
                                    const match = lastCode.match(replacement.match);

                                    // Use 200 surrounding characters of context
                                    const start = Math.max(0, match.index - 200);
                                    const end = Math.min(lastCode.length, match.index + match[0].length + 200);
                                    // (changeSize may be negative)
                                    const endPatched = end + changeSize;

                                    const context = lastCode.slice(start, end);
                                    const patchedContext = code.slice(start, endPatched);

                                    // inline require to avoid including it in !IS_DEV builds
                                    const diff = Diff.diffWordsWithSpace(context, patchedContext);
                                    let fmt = "%c %s ";
                                    const elements = [];
                                    for (const d of diff) {
                                        const color = d.removed
                                            ? "red"
                                            : d.added
                                                ? "lime"
                                                : "grey";
                                        fmt += "%c%s";
                                        elements.push("color:" + color, d.value);
                                    }
                                }
                                code = lastCode;
                                mod = lastMod;
                                patchedBy.delete(patch.plugin);
                            }
                        }

                        if (!patch.all) patches.splice(i--, 1);
                    }
                }
            }
        } catch (err) {
            logger.error("Error in handlePush", err);
        }

        return handlePush.original.call(window[WEBPACK_CHUNK], chunk);
    }

    handlePush.original = window[WEBPACK_CHUNK].push;
    Object.defineProperty(window[WEBPACK_CHUNK], "push", {
        get: () => handlePush,
        set: v => (handlePush.original = v),
        configurable: true
    });
}
