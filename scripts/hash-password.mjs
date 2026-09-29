// Prints the developer account's password hash, ready for .env:
//   pnpm dev:hash-password "your-strong-password"
// The bcrypt hash is base64-encoded because Next.js expands "$" inside .env
// values, which would corrupt a raw bcrypt hash. The plain password is never
// stored anywhere.
import bcrypt from "bcryptjs";

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error('Usage: pnpm dev:hash-password "a password of at least 12 characters"');
  process.exit(1);
}
const hash = await bcrypt.hash(password, 12);
console.log(`DEVELOPER_PASSWORD_HASH=${Buffer.from(hash).toString("base64")}`);
