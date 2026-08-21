import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
const INVALID_PERCENT = /%(?![0-9a-f]{2})/i;
const ENCODED_SEPARATOR_OR_CONTROL = /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i;
const RESIDUAL_DANGEROUS_ENCODING = /%(?:25|2e|2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i;
const CONTROL = /[\u0000-\u001f\u007f]/;
/** Decode the origin-form request path exactly once, before URL normalization. */
export function decodeStaticRequestPath(rawTarget) {
    const rawPath = rawTarget.split("?", 1)[0];
    if (!rawPath.startsWith("/") || rawPath.startsWith("//") || INVALID_PERCENT.test(rawPath))
        return null;
    // Encoded separators make segment ownership ambiguous. Decode neither a
    // slash nor a backslash into a new path boundary.
    if (ENCODED_SEPARATOR_OR_CONTROL.test(rawPath))
        return null;
    let decoded;
    try {
        decoded = decodeURIComponent(rawPath);
    }
    catch {
        return null;
    }
    if (CONTROL.test(decoded) || decoded.includes("\\") || RESIDUAL_DANGEROUS_ENCODING.test(decoded))
        return null;
    const segments = decoded.split("/");
    if (segments.some((segment) => segment === "." || segment === ".."))
        return null;
    return decoded === "/" ? "/index.html" : decoded;
}
/** Resolve and snapshot one regular non-symlink file inside the static root. */
export function readStaticFile(rootValue, requestPath) {
    let root;
    try {
        root = realpathSync(resolve(rootValue));
    }
    catch {
        return null;
    }
    const candidate = resolve(root, `.${requestPath}`);
    const lexical = relative(root, candidate);
    if (isAbsolute(lexical) || lexical === ".." || lexical.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`))
        return null;
    let canonical;
    let fd = null;
    try {
        const before = lstatSync(candidate);
        if (!before.isFile() || before.isSymbolicLink())
            return null;
        canonical = realpathSync(candidate);
        const contained = relative(root, canonical);
        if (isAbsolute(contained) || contained === ".." || contained.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`))
            return null;
        fd = openSync(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        const opened = fstatSync(fd);
        if (!opened.isFile() || opened.size !== before.size || realpathSync(candidate) !== canonical)
            return null;
        const bytes = readFileSync(fd);
        if (bytes.length !== opened.size || realpathSync(candidate) !== canonical)
            return null;
        return { bytes, canonicalPath: canonical };
    }
    catch {
        return null;
    }
    finally {
        if (fd !== null)
            closeSync(fd);
    }
}
