import { randomBytes, scrypt as nodeScrypt } from "node:crypto";

const KEY_LENGTH = 32;
const N = 32_768;
const R = 8;
const P = 1;
const MAX_MEMORY = 64 * 1024 * 1024;

async function main() {
  const password = process.stdin.isTTY
    ? await readAndConfirmPassword()
    : await readPasswordFromStdin();
  if (password.length < 12) {
    throw new Error("The administrator password must contain at least 12 characters.");
  }
  const passwordHash = await hashPassword(password);
  const sessionSecret = randomBytes(32).toString("base64url");
  process.stdout.write([
    "\nAdd these values to .env or the container configuration:\n\n",
    "AUTH_MODE=password\n",
    "AUTH_USERNAME=admin\n",
    `AUTH_PASSWORD_HASH=${passwordHash}\n`,
    `AUTH_SESSION_SECRET=${sessionSecret}\n`,
    "AUTH_SESSION_HOURS=12\n",
    "AUTH_COOKIE_SECURE=auto\n",
    "AUTH_TRUST_PROXY_HEADERS=false\n",
  ].join(""));
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await derive(password, salt);
  return [
    "scrypt-v1",
    `N=${N},r=${R},p=${P}`,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join(":");
}

async function readAndConfirmPassword() {
  const first = await readHidden("Administrator password: ");
  const second = await readHidden("Confirm password: ");
  if (first !== second) throw new Error("The passwords did not match.");
  return first;
}

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stderr;
    let value = "";
    output.write(prompt);
    input.setRawMode?.(true);
    input.resume();
    input.setEncoding("utf8");
    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode?.(false);
      input.pause();
      output.write("\n");
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Password generation was cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else value += character;
      }
    };
    input.on("data", onData);
  });
}

async function readPasswordFromStdin() {
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) value += chunk;
  return value.replace(/[\r\n]+$/, "");
}

function derive(password, salt) {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAX_MEMORY }, (error, key) => {
      if (error) reject(error);
      else resolve(Buffer.from(key));
    });
  });
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Authentication setup failed."}\n`);
  process.exitCode = 1;
});
