import { UserRole, createUser, findUserByUsername } from "../src/repositories/UsersRepository.js";
import { hashPassword } from "../src/utils/hash.js";
import { pool } from "../src/db/pool.js";

function usageAndExit(): never {
  console.error("Usage: npm run create-user -- <username> <password> [admin|user]");
  process.exit(1);
}

async function main(): Promise<void> {
  const [username, password, roleArg] = process.argv.slice(2);
  if (!username || !password) {
    usageAndExit();
  }
  if (password.length < 12) {
    console.error("Password must be at least 12 characters.");
    process.exit(1);
  }

  const role: UserRole = roleArg === UserRole.Admin ? roleArg : UserRole.User;

  const existing = await findUserByUsername(username);
  if (existing) {
    console.error(`User "${username}" already exists.`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const user = await createUser(username, passwordHash, role);
  console.log(`Created user #${user.id} "${user.username}" (role: ${user.role}).`);

  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
