import type { SessionRow } from "../repositories/SessionsRepository.js";
import type { UserRow } from "../repositories/UsersRepository.js";

declare global {
  namespace Express {
    interface Request {
      session?: SessionRow;
      user?: UserRow;
    }
  }
}

export {};
