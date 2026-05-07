import { betterAuth } from "better-auth";
import { Pool } from "pg";
import { nextCookies } from "better-auth/next-js";

// creator.lottiepro.com/lib/auth.ts
export const auth = betterAuth({
  database: new Pool({
    connectionString: process.env.DATABASE_URL,
  }),
  secret: process.env.BETTER_AUTH_SECRET, // ⚠️ MUST be the same secret as main app

  baseURL: process.env.BETTER_AUTH_URL, // https://lottiepro.com in production

  advanced: {
    cookies: {
      sessionToken: {
        name: "__Secure-better-auth.session_token", // double underscore
        attributes: {
          domain: ".lottiepro.com",
          path: "/",
          httpOnly: true,
          secure: true,
          sameSite: "none",
        },
      },
    },
  },
  plugins: [], // keep here only if needed for reading in server components
});
